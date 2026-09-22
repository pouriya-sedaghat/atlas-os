# Bundled font

`atlas-os` renders Persian and English basemap labels offline, so the signed-distance-field
glyphs served from `/maps/...` are generated locally from a font committed here. No font is
fetched from a CDN at build time or at runtime.

## Vazirmatn-Regular.ttf

| Field      | Value                                                                        |
| ---------- | ---------------------------------------------------------------------------- |
| Family     | Vazirmatn                                                                    |
| Style      | Regular                                                                      |
| Version    | 33.0.3                                                                       |
| Coverage   | Persian/Arabic, Arabic presentation forms, Latin, Western and Persian digits |
| Authors    | The Vazirmatn Project Authors                                                |
| Upstream   | <https://github.com/rastikerdar/vazirmatn>                                   |
| Provenance | `fonts/ttf/Vazirmatn-Regular.ttf` from the npm package `vazirmatn@33.0.3`    |
| Size       | 122752 bytes                                                                 |
| SHA-256    | `b69fd4c680b8f3f225feabcc655a2c585d97627b8f5f5c0f9985e894069f3a56`           |
| License    | SIL Open Font License 1.1 (see `OFL.txt`)                                    |

`OFL.txt` is the upstream license text, SHA-256
`e6f4ce7b6c830d5a25a4f8ac777c267cd7d3c180bc2a7150ca57cbb9b280c4b7`. It is the upstream
text with one line's trailing whitespace removed; no wording was altered.

The SIL Open Font License 1.1 permits redistribution of the font software, bundled or
standalone, provided the copyright notice and licence text travel with it — which is why
`OFL.txt` sits beside the font and is reproduced in `THIRD_PARTY_NOTICES.md`. The licence
also forbids selling the font on its own and forbids reuse of the reserved font name; neither
applies here. Only the single Regular weight is committed, rather than the 19 MB upstream
package, to keep the repository small.

Glyph ranges are derived from this file during basemap provisioning. The generated
`glyphs/{fontstack}/{range}.pbf` resources live under `data/` and are never committed.
