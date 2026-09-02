# ffmpeg, shipped with Dialect

Reading a clip or a track means decoding it, and Dialect does not decode
anything itself — ffmpeg does. A machine that has never heard of ffmpeg should
still be able to read a clip, so a copy travels with the app.

`ffmpeg` and `ffprobe` go in this folder and are picked up automatically. They
are not in the repository: they are fetched during the release build, because
several hundred megabytes of third-party binary does not belong in git history.

A copy already on PATH is used when there is none here, which is what happens
on a development machine.

## Licence

ffmpeg is not ours and is not covered by Dialect's licence. It is available
under the LGPL, and under the GPL when built with certain components — which
build is shipped is a decision with consequences for Dialect itself, so the
release workflow names its source explicitly rather than fetching whatever is
newest.

Whatever is shipped, its licence text must ship beside it. That is what this
folder is for as much as the binaries are.
