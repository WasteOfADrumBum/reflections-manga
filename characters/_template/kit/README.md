# Character Kit

Status: Template. Copy this `kit/` folder into a character directory
(for example `characters/main/<id>/kit/`) and fill it in.

A character kit is everything needed to perform a character in any format:
manga, anime or motion comic, film, and a game. Build it once per character.
Every later format draws from the same kit instead of starting over.

The kit sits beside the character's existing profile files. It links to them
and never replaces them:

| Already in the character folder | What the kit adds |
|---|---|
| `index.md`, `appearance.md`, `personality.md` | `bible.md`: how the character talks, moves and reacts on screen |
| `references/`, `outfits/` | `sheets/`: turnaround, expressions, palette and key poses |
| `prompts/` | Voice, motion and model prompts live in their own kit folders |

## The Five Parts, in Order

1. **Bible** (`bible.md`): speech style, catchphrases, posture, walk, nervous
   habits and on-screen relationship dynamics. Every other part works from it,
   so fill it in first.
2. **Visual sheets** (`sheets/`): front, side and back turnaround, 6 to 8
   expressions, color palette and a few key poses. Outfits stay in `outfits/`.
3. **Voice** (`voice/`): voice design notes, one short "I am..." bio script,
   and the audio clip once it is made.
4. **Motion reference** (`motion/`): written mannerism notes plus short clips
   of the walk, idle stance and talking style.
5. **3D model** (`model/`): placeholder until the game stage starts.

## How Each Part Feeds Each Format

| Part | Manga | Anime, motion comic or film | Game |
|---|---|---|---|
| Bible | Dialogue, acting in panels | Voice direction, acting, animation notes | Dialogue trees, barks, AI behavior |
| Sheets | Consistent faces and poses | Model sheets for animators and image-to-video | Concept art for the 3D model |
| Voice | Not used | Dialogue recording | In-game dialogue |
| Motion | Pose ideas for action panels | Walk cycles, idle loops, lip-sync style | Animation reference for the rig |
| Model | Optional pose reference | Optional 3D camera shots | The playable or in-world character |

Video does not convert into 3D. What carries from video to a game is the
character's voice, personality, look and mannerisms. The 3D model is built
from the turnaround in `sheets/`, so a clean turnaround matters most.

## What to Do First

Fill in the bible and the visual sheets for the two or three main characters
while the manga continues. Voice, motion and model can wait.

## Status Rules

The kit follows the [global character rules](../../_character-rules.md):

- A kit file never approves canon. Record approvals in the character's
  existing profile and reference files.
- Every fact in the kit links to where it was established. Anything not yet
  established is marked `TODO` for the creator to supply.
- Do not invent permanent traits, backstory, accents or occupations to fill a gap.
- Files named here as slots (audio, video, images, models) are added only when
  they exist. An empty slot is listed in code formatting, not as a link.

## Costs

Generating a voice in ElevenLabs, or images and video in paid tools, spends
credits. Write the notes and scripts first. Generate only on the creator's yes.

## File Naming

Follow the existing `<id>-<description>` pattern:

- `voice/<id>-voice-bio.mp3`
- `sheets/<id>-turnaround.png`, `sheets/<id>-expressions.png`, `sheets/<id>-poses.png`
- `motion/<id>-motion-walk.mp4`, `motion/<id>-motion-idle.mp4`, `motion/<id>-motion-talk.mp4`
- `model/<id>.glb` (or the format the game engine uses)

Kit images are not part of `asset-manifest.json`, which tracks only
`references/` and `outfits/`. Record each kit file's source and approval state
in that folder's `README.md`.

## Accessibility, If Kit Media Goes on the Site

- Every audio clip has a text transcript beside it. The bio script is the transcript.
- Every video has captions and a short text description of what it shows.
- No autoplay. Players need visible, keyboard-operable controls.
- Every image needs alt text describing the character and pose.
