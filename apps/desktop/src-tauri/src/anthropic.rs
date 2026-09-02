//! The model call, made from the host so the key never enters the web view.
//!
//! This is a proxy, not a second implementation. The schema, the prompt, the
//! mapping into IR and every rule stay in TypeScript, shared with the CLI; all
//! that lives here is the one thing the web view must not be trusted with —
//! the credential, and the request that carries it.
//!
//! Structured outputs do the parsing: the model is handed the same JSON schema
//! the TypeScript side validates against, and answers with JSON in its first
//! text block.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::secrets;

const ENDPOINT: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2023-06-01";

#[derive(Deserialize)]
pub struct ImagePart {
    media_type: String,
    base64: String,
}

#[derive(Deserialize)]
pub struct ExtractRequest {
    system: String,
    instruction: String,
    images: Vec<ImagePart>,
    /// JSON Schema the answer must satisfy.
    schema: Value,
    model: String,
    max_tokens: u32,
    effort: Option<String>,
}

#[derive(Serialize, Default)]
pub struct Usage {
    input_tokens: u64,
    output_tokens: u64,
    cache_read_input_tokens: u64,
    cache_creation_input_tokens: u64,
}

#[derive(Serialize)]
pub struct ExtractResponse {
    value: Value,
    model: String,
    usage: Usage,
}

fn usage_field(usage: &Value, name: &str) -> u64 {
    usage.get(name).and_then(Value::as_u64).unwrap_or(0)
}

#[tauri::command]
pub async fn anthropic_extract(request: ExtractRequest) -> Result<ExtractResponse, String> {
    let key = secrets::secret_get(secrets::ANTHROPIC.to_string())?
        .ok_or("No Anthropic key is stored. Add one in Settings.")?;

    let mut content: Vec<Value> = request
        .images
        .iter()
        .map(|img| {
            json!({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": img.media_type,
                    "data": img.base64,
                }
            })
        })
        .collect();
    content.push(json!({ "type": "text", "text": request.instruction }));

    let mut output_config = json!({
        "format": { "type": "json_schema", "schema": request.schema }
    });
    if let Some(effort) = request.effort.as_deref() {
        output_config["effort"] = json!(effort);
    }

    let body = json!({
        "model": request.model,
        "max_tokens": request.max_tokens,
        "system": request.system,
        // Reading a picture into twenty-odd structured fields is not a
        // one-glance task, so let the model think about it.
        "thinking": { "type": "adaptive" },
        "output_config": output_config,
        "messages": [{ "role": "user", "content": content }],
    });

    let response = reqwest::Client::new()
        .post(ENDPOINT)
        .header("x-api-key", key)
        .header("anthropic-version", API_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Could not reach Anthropic: {e}"))?;

    let status = response.status();
    let payload: Value = response
        .json()
        .await
        .map_err(|e| format!("Anthropic returned something that is not JSON: {e}"))?;

    if !status.is_success() {
        let detail = payload
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("no detail given");
        return Err(match status.as_u16() {
            401 => format!("Anthropic rejected the stored key: {detail}"),
            429 => format!("Rate limited by Anthropic: {detail}"),
            _ => format!("Anthropic error {status}: {detail}"),
        });
    }

    // Always check why it stopped before reading what it said.
    match payload.get("stop_reason").and_then(Value::as_str) {
        Some("refusal") => {
            let why = payload
                .pointer("/stop_details/explanation")
                .and_then(Value::as_str)
                .unwrap_or("no explanation given");
            return Err(format!("The model declined this reference: {why}"));
        }
        Some("max_tokens") => {
            return Err(format!(
                "The description was cut off at {} tokens. Raise the limit.",
                request.max_tokens
            ));
        }
        _ => {}
    }

    // Structured outputs put the answer in the first text block.
    let text = payload
        .get("content")
        .and_then(Value::as_array)
        .and_then(|blocks| {
            blocks
                .iter()
                .find(|b| b.get("type").and_then(Value::as_str) == Some("text"))
        })
        .and_then(|b| b.get("text"))
        .and_then(Value::as_str)
        .ok_or("Anthropic returned no text block to read.")?;

    let value: Value = serde_json::from_str(text)
        .map_err(|e| format!("The model's answer was not the JSON it promised: {e}"))?;

    let usage = payload.get("usage").cloned().unwrap_or_else(|| json!({}));

    Ok(ExtractResponse {
        value,
        model: payload
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or(&request.model)
            .to_string(),
        usage: Usage {
            input_tokens: usage_field(&usage, "input_tokens"),
            output_tokens: usage_field(&usage, "output_tokens"),
            cache_read_input_tokens: usage_field(&usage, "cache_read_input_tokens"),
            cache_creation_input_tokens: usage_field(&usage, "cache_creation_input_tokens"),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
    }

    /// The one test that costs money.
    ///
    /// Everything else about extraction is proved against a mock; this proves
    /// the boundary the mock stands in for — that the stored key is reachable,
    /// that the request shape is one the API accepts, and that structured
    /// outputs come back as the schema we asked for. Ignored by default so a
    /// plain `cargo test` never spends anything.
    ///
    ///     cargo test --  --ignored live_extraction
    #[tokio::test]
    #[ignore = "makes a real, billed API call"]
    async fn live_extraction() {
        // The fixtures are not in the repository: the schema is generated and
        // the reference is whatever image you point it at. Say so rather than
        // panicking on a path.
        if !fixture("extraction.json").exists() || !fixture("reference.jpg").exists() {
            eprintln!(
                "skipped: put an image at {} and generate the schema into {}",
                fixture("reference.jpg").display(),
                fixture("extraction.json").display(),
            );
            return;
        }

        let payload: Value =
            serde_json::from_str(&fs::read_to_string(fixture("extraction.json")).unwrap()).unwrap();
        let image = fs::read(fixture("reference.jpg")).unwrap();

        // Built the same way the web view builds it, so the shape is under test
        // and not just the transport.
        let request: ExtractRequest = serde_json::from_value(json!({
            "system": payload["system"],
            "instruction": payload["instruction"],
            "images": [{
                "media_type": "image/jpeg",
                "base64": base64(&image),
            }],
            "schema": payload["schema"],
            "model": "claude-sonnet-5",
            "max_tokens": 16000,
            "effort": null,
        }))
        .unwrap();

        let response = anthropic_extract(request)
            .await
            .unwrap_or_else(|e| panic!("the live call failed: {e}"));

        // Kept so the next thing that needs a real answer does not have to buy
        // one: the TypeScript side can be checked against this offline.
        let saved = fixture("last-response.json");
        fs::write(&saved, serde_json::to_string_pretty(&response.value).unwrap()).unwrap();
        println!("saved to {}", saved.display());

        let scene = &response.value;
        println!("model: {}", response.model);
        println!(
            "tokens in/out: {}/{}",
            response.usage.input_tokens, response.usage.output_tokens
        );
        println!("{}", serde_json::to_string_pretty(scene).unwrap());

        // The schema asked for these; if structured outputs held, they are here.
        for key in ["headline", "entities", "lightingKey", "opticsEffect", "shotSize"] {
            assert!(scene.get(key).is_some(), "the answer has no \"{key}\"");
        }
        assert!(
            !scene["headline"].as_str().unwrap_or("").is_empty(),
            "the headline came back empty"
        );
        assert!(response.usage.output_tokens > 0, "nothing was generated");
    }

    /// Minimal base64, so the test needs no extra dependency.
    fn base64(bytes: &[u8]) -> String {
        const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
        for chunk in bytes.chunks(3) {
            let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
            let n = u32::from(b[0]) << 16 | u32::from(b[1]) << 8 | u32::from(b[2]);
            for i in 0..4 {
                if i <= chunk.len() {
                    out.push(A[(n >> (18 - i * 6)) as usize & 0x3F] as char);
                } else {
                    out.push('=');
                }
            }
        }
        out
    }
}
