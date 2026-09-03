//! Fetching a prompting guide, and reducing it to something worth reading.
//!
//! A web view cannot fetch another origin, so the host does it. What comes back
//! is a whole web page: navigation, cookie banners, a footer of legal links, and
//! somewhere in the middle the thing that was asked for.
//!
//! It is reduced here rather than in the window for two reasons. The page is
//! often several hundred kilobytes of markup around a few kilobytes of prose,
//! and every one of those kilobytes would be paid for at the model's input rate
//! if it crossed the bridge whole. And the reduction is exactly the kind of
//! thing worth testing, which is easier on this side.
//!
//! The reduction is deliberately crude — tags out, block boundaries kept as
//! newlines. A guide's meaning is in its sentences and its lists, and both
//! survive that. Nothing here tries to understand the page.

use std::time::Duration;

use serde::Serialize;

/// Past this a page is not a guide, it is a download.
const MAX_BYTES: usize = 6 * 1024 * 1024;

/// Long enough for a slow docs site, short enough that a wrong link is not a
/// minute of staring at a spinner.
const TIMEOUT_S: u64 = 30;

#[derive(Serialize)]
pub struct Fetched {
    /// The page's `<title>`, where it has one.
    pub title: String,
    /// The readable text.
    pub text: String,
    /// Where it came from, after any redirects — which is the address to record.
    pub url: String,
}

/// Fetch one page and hand back its text.
#[tauri::command]
pub async fn guide_fetch(url: String) -> Result<Fetched, String> {
    let url = url.trim().to_string();
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("A guide is a web address beginning http:// or https://.".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(TIMEOUT_S))
        // Some documentation sites serve a stub to anything that does not look
        // like a browser. Saying what this is, honestly, gets the prose.
        .user_agent("Dialect/1.0 (model card reader)")
        .build()
        .map_err(|e| format!("Could not start the fetch: {e}"))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Could not reach {url}: {e}"))?;

    let landed = response.url().to_string();
    let status = response.status();
    if !status.is_success() {
        return Err(format!("{url} answered {status}."));
    }

    let kind = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    // A PDF is the other half of how vendors publish these, and this cannot
    // read one. Said plainly, because "0 characters" would not explain it.
    if kind.contains("application/pdf") {
        return Err(
            "That link is a PDF, which this cannot read yet. Open it and paste the text, or find the same guide as a web page."
                .to_string(),
        );
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("Could not read {url}: {e}"))?;

    if body.len() > MAX_BYTES {
        return Err(format!(
            "That page is {} MB, which is not a prompting guide.",
            body.len() / 1_048_576
        ));
    }

    Ok(Fetched {
        title: title_of(&body),
        text: if kind.contains("text/html") || body.trim_start().starts_with('<') {
            readable(&body)
        } else {
            body
        },
        url: landed,
    })
}

/// The contents of `<title>`, tidied.
fn title_of(html: &str) -> String {
    let lower = html.to_lowercase();
    let Some(open) = lower.find("<title") else {
        return String::new();
    };
    let Some(gt) = lower[open..].find('>') else {
        return String::new();
    };
    let start = open + gt + 1;
    let Some(end) = lower[start..].find("</title>") else {
        return String::new();
    };
    collapse(&unescape(&html[start..start + end]))
}

/// Markup out, sentences and list items kept.
///
/// `script` and `style` go with their contents — a page's JavaScript is bigger
/// than its prose and means nothing here. Everything else becomes text, with
/// block-level tags becoming newlines so a list does not arrive as one
/// run-on sentence.
pub fn readable(html: &str) -> String {
    let without_code = strip_element(&strip_element(html, "script"), "style");

    let mut out = String::with_capacity(without_code.len() / 4);
    let bytes = without_code.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'<' {
            let Some(close) = without_code[i..].find('>') else {
                break;
            };
            let tag = &without_code[i + 1..i + close];
            if breaks_line(tag) {
                out.push('\n');
            }
            i += close + 1;
        } else {
            let next = without_code[i..].find('<').map_or(bytes.len(), |n| i + n);
            out.push_str(&without_code[i..next]);
            i = next;
        }
    }

    collapse_blocks(&unescape(&out))
}

/// Tags after which a line ends, so structure survives as line breaks.
fn breaks_line(tag: &str) -> bool {
    let name: String = tag
        .trim_start_matches('/')
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_lowercase();

    matches!(
        name.as_str(),
        "p" | "br"
            | "div"
            | "li"
            | "tr"
            | "td"
            | "th"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "section"
            | "article"
            | "header"
            | "footer"
            | "pre"
            | "blockquote"
            | "table"
            | "ul"
            | "ol"
            | "dl"
            | "dt"
            | "dd"
            | "hr"
    )
}

/// One element and everything inside it, removed.
fn strip_element(html: &str, name: &str) -> String {
    let lower = html.to_lowercase();
    let open = format!("<{name}");
    let close = format!("</{name}>");

    let mut out = String::with_capacity(html.len());
    let mut i = 0;

    while let Some(found) = lower[i..].find(&open) {
        let at = i + found;
        out.push_str(&html[i..at]);
        match lower[at..].find(&close) {
            Some(end) => i = at + end + close.len(),
            // Unclosed: everything after it is inside, so it all goes.
            None => return out,
        }
    }
    out.push_str(&html[i..]);
    out
}

/// Longest a numeric entity's body can sensibly be — `&#x1F600;` is six.
const ENTITY_BODY: usize = 8;

/// The five entities that actually matter, plus numeric ones.
///
/// Written as a forward scan with a cursor rather than as repeated
/// find-and-replace over one buffer. The first version replaced in place and
/// "neutralised" anything that turned out not to be an entity by writing `&#`
/// as `&#38;#` — which still contains `&#`, so `find` returned the same
/// position, decoded it back to `&`, and went round again for ever. It hung the
/// test suite, and it would have hung on any page containing a bare `&#`.
///
/// A cursor cannot do that: every branch moves past what it just looked at.
fn unescape(text: &str) -> String {
    let named = text
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'");

    let mut out = String::with_capacity(named.len());
    let mut rest = named.as_str();

    // &#8217; and friends, which documentation is full of.
    while let Some(start) = rest.find("&#") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];

        let window = &after[..after.len().min(ENTITY_BODY)];
        let decoded = window.find(';').and_then(|end| {
            let body = &after[..end];
            let code = if let Some(hex) = body.strip_prefix('x').or_else(|| body.strip_prefix('X')) {
                u32::from_str_radix(hex, 16).ok()
            } else {
                body.parse::<u32>().ok()
            };
            code.and_then(char::from_u32).map(|ch| (ch, end))
        });

        match decoded {
            Some((ch, end)) => {
                out.push(ch);
                rest = &after[end + 1..];
            }
            // Not an entity. Kept as written, and stepped over.
            None => {
                out.push_str("&#");
                rest = after;
            }
        }
    }
    out.push_str(rest);

    // Last, so a page writing `&amp;#39;` for a literal "&#39;" gets that
    // rather than an apostrophe.
    out.replace("&amp;", "&")
}

/// Runs of whitespace to one space.
fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Each line collapsed, empty lines dropped, at most one blank between blocks.
fn collapse_blocks(text: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    for line in text.lines() {
        let tidy = collapse(line);
        if tidy.is_empty() {
            continue;
        }
        out.push(tidy);
    }
    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_the_prose_and_leaves_the_markup() {
        let html = r#"<html><head><title>Kling 3.0 — Prompting</title>
            <style>body { color: red }</style>
            <script>var tracker = "<p>not prose</p>";</script></head>
            <body><h1>Prompt structure</h1>
            <p>Write the subject first.</p>
            <ul><li>Subject</li><li>Movement</li></ul>
            <p>Clips are capped at 10&nbsp;seconds &amp; cannot be extended.</p>
            </body></html>"#;

        let text = readable(html);

        assert!(text.contains("Prompt structure"));
        assert!(text.contains("Write the subject first."));
        // A list arrives as lines, not as one run-on sentence.
        assert!(text.contains("Subject\nMovement"), "{text}");
        assert!(text.contains("capped at 10 seconds & cannot"), "{text}");

        // Script and style go with their contents, including markup inside them.
        assert!(!text.contains("tracker"), "{text}");
        assert!(!text.contains("not prose"), "{text}");
        assert!(!text.contains("color: red"), "{text}");
        assert!(!text.contains('<'), "{text}");
    }

    #[test]
    fn reads_the_title() {
        assert_eq!(
            title_of("<html><head><title>  Sora 2  guide </title></head></html>"),
            "Sora 2 guide"
        );
        assert_eq!(title_of("<html><head></head></html>"), "");
    }

    #[test]
    fn turns_numeric_entities_into_the_characters_they_name() {
        // Documentation is full of these, and a guide arriving as &#8217;s
        // reads as noise to a model as much as to a person.
        assert_eq!(unescape("don&#8217;t"), "don’t");
        assert_eq!(unescape("A&#x2014;B"), "A—B");
        assert_eq!(unescape("&#38;"), "&");
    }

    /// The first version of `unescape` hung on this, for ever, and took the
    /// test suite with it. Anything that only looks like an entity has to be
    /// left alone and stepped over.
    #[test]
    fn something_that_is_not_an_entity_is_left_alone_and_does_not_spin() {
        assert_eq!(unescape("2 &# 3;"), "2 &# 3;");
        assert_eq!(unescape("&#"), "&#");
        assert_eq!(unescape("&#;"), "&#;");
        // A semicolon far enough away is punctuation, not the end of an entity.
        assert_eq!(unescape("a &# b c d e f g h i;"), "a &# b c d e f g h i;");
        assert_eq!(unescape("&#x;"), "&#x;");
        // Several in a row, which is where a cursor that fails to advance shows.
        assert_eq!(unescape("&#a; &#b; &#c;"), "&#a; &#b; &#c;");
        // And one real one after two false ones.
        assert_eq!(unescape("&#a; &#b; &#8217;"), "&#a; &#b; ’");
    }

    #[test]
    fn an_escaped_ampersand_is_not_read_as_starting_an_entity() {
        // A page writing &amp;#39; means the literal text "&#39;", not an
        // apostrophe — so the ampersand is decoded last, not first.
        assert_eq!(unescape("&amp;#39;"), "&#39;");
        assert_eq!(unescape("black &amp; white"), "black & white");
    }

    #[test]
    fn an_unclosed_script_takes_the_rest_of_the_page() {
        // Better than emitting a page's worth of JavaScript as if it were prose.
        let text = readable("<p>Before</p><script>x = 1;");
        assert!(text.contains("Before"));
        assert!(!text.contains("x = 1"));
    }
}
