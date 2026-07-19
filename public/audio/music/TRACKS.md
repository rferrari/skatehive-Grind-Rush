# Music playlist — drop these files here

The game plays these six files in order (3 rap → 3 punk) and loops the set.
Filenames are what `src/audio.js` (`MUSIC_TRACKS`) expects — save each track
under exactly these names. Any missing file is silently skipped, so the game
runs fine before they're added; SFX are synthesized and always on.

All tracks below are verified free for **commercial use** (safe for a
prize-money game). Pixabay = no attribution; CC0 = public domain, no
attribution. Download each from its page and rename.

| Save as | Track | Artist | License | Source |
|---|---|---|---|---|
| `rap-1.mp3` | 90s-style boom bap beat with dusty vinyl crackles | DesiFreeMusic | Pixabay (no attribution) | https://pixabay.com/music/beats-90s-style-boom-bap-beat-with-dusty-vinyl-crackles-378424/ |
| `rap-2.mp3` | Jazzy Boom Bap Hip-Hop | VibeCroft | Pixabay (no attribution) | https://pixabay.com/music/lofi-jazzy-boom-bap-hip-hop-507856/ |
| `rap-3.mp3` | Jazzy Hip Hop Boom Bap | Music_Unlimited | Pixabay (no attribution) | https://pixabay.com/music/beats-jazzy-hip-hop-boom-bap-111861/ |
| `punk-1.mp3` | Skater Punk Rock Instrumental | nickpanek620 | Pixabay (no attribution) | https://pixabay.com/music/punk-skater-punk-rock-instrumental-232237/ |
| `punk-2.mp3` | Punk Storm Mario instrumental | (Pixabay) | Pixabay (no attribution) | https://pixabay.com/music/rock-punk-storm-mario-instrumental-225372/ |
| `punk-3.mp3` | Punk | HoliznaCC0 | CC0 (public domain) | https://freemusicarchive.org/music/holiznacc0/rock-montage/punk/ |

Reorder or swap freely by editing `MUSIC_TRACKS` in `src/audio.js`.

## License note (important for the repo)
Pixabay tracks carry the **Pixabay Content License**, not this repo's license:
they may be used/looped commercially with no attribution, but must NOT be
redistributed as standalone files / a music pack. Keeping them embedded in the
game is fine. The HoliznaCC0 track is CC0 (no restrictions). If you prefer a
single credit line anyway: "Music: Pixabay & HoliznaCC0 (CC0)".
