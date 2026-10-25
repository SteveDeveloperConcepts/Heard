# SteveNola

AI meeting notes for macOS and Windows. Hit record, jot quick notes, and SteveNola transcribes your mic and the call audio live, on your own computer, with no transcription account needed. When you stop recording, your chosen AI turns your notes plus the transcript into clean meeting notes that open with a summary, and gives the meeting a title. You can also ask questions about any meeting.

## Install and run

### Download

Get the latest installer from [Releases](https://github.com/SteveDeveloperConcepts/SteveNola/releases/latest):

- **Windows 10 or 11:** `SteveNola-Setup-<version>.exe`. The installer isn't code-signed yet, so Windows may say "Windows protected your PC". Click **More info**, then **Run anyway**.
- **macOS 13 or later on Apple Silicon (M1 or newer):** `SteveNola-<version>-arm64.dmg`. Open it and drag SteveNola to Applications. The app isn't notarized by Apple yet, so the first time you open it macOS says it can't verify it. Click **Done**, open **System Settings → Privacy & Security**, and click **Open Anyway**.

Then see [First launch](#first-launch). To run from the source code instead, read on.

### What you need

- **Windows 10 or 11**, or **macOS 13 Ventura or later**. Built-in transcription on a Mac needs Apple Silicon (M1 or newer).
- **Node.js 22.12 or newer** (20.19 or newer also works). Get the LTS installer from https://nodejs.org; it includes npm. Check your version with `node --version`.
- About **1.2 GB of disk space**: about 1 GB for the build tools and Electron, plus about 130 MB for the speech model.
- An internet connection for the install and your first recording. After that, recording and transcription work offline.
- **Mac only, for call detection:** Apple's command line tools (`xcode-select --install`).

### Run it

Open a terminal in the SteveNola folder (PowerShell on Windows, Terminal on a Mac) and install the dependencies. This also downloads Electron:

```bash
npm install
```

On a Mac, build the call-detection helper once. Without it, SteveNola works but won't notice WhatsApp and other calls:

```bash
npm run helper:mac
```

Start SteveNola:

```bash
npm run dev
```

The window opens after a few seconds, and code changes reload automatically. Closing the window leaves SteveNola running in the tray (the menu bar on a Mac) so it can catch calls. To quit, choose **Quit** from the tray icon's menu, or press Ctrl+C in the terminal.

### First launch

1. **Pick your AI.** In Settings → AI for notes and questions, choose a provider and paste its API key (Claude is the default). Choose Ollama to run without a key. Recording and transcripts work without an AI; only the summary, Enhance and Ask need one.
2. **Record.** Click **Start recording**. The first time, SteveNola downloads the speech model (about 130 MB) and shows progress in the recording bar. To download it in advance, use Settings → Transcription → **Download now**.
3. **Allow access.** Allow microphone access when asked. On a Mac, also allow **Screen & System Audio Recording**, so the other side of a call is captured (see [Permissions](#permissions)).
4. **Gmail (optional).** If you're signed in to several Google accounts, pick the one to send from in Settings → Sharing.

### Install it as a regular app

Build the installer on the kind of computer it's for: the Windows installer on Windows, the Mac app on a Mac.

**Windows:**

```bash
npm run dist:win
```

This makes `dist\SteveNola-Setup-0.1.0.exe`. Run it and follow the steps; SteveNola then appears in the Start menu. The installer isn't code-signed, so Windows SmartScreen may say "Windows protected your PC". Click **More info**, then **Run anyway**.

**macOS:**

```bash
npm run dist:mac
```

This also builds the call-detection helper, and makes `dist/SteveNola-0.1.0-arm64.dmg`. Open it and drag SteveNola to Applications. The app isn't signed by Apple. If macOS says it can't be opened, go to System Settings → Privacy & Security and click **Open Anyway**.

The installed app uses the same data folder as `npm run dev`, so your meetings, settings and downloaded speech model carry over.

The Mac app is only ad-hoc signed, so other people have to use **Open Anyway** too, and macOS asks for microphone and screen-audio permission again after each update. To avoid both, sign it with an Apple Developer ID certificate: remove `identity: '-'` and set `notarize: true` in [electron-builder.yml](electron-builder.yml).

### If something goes wrong

- **`Error: Electron uninstall` when starting:** Electron's download didn't finish. Run `node node_modules/electron/install.js`, then `npm run dev` again.
- **Errors that mention the Node.js version:** install the current Node.js LTS from https://nodejs.org, then run `npm install` again.
- **The speech model won't download:** the first recording needs internet access to huggingface.co. Once you're online, use Settings → Transcription → **Download now**.
- **No "Them" lines during a call:** check that system audio capture is on in Settings → Audio. On a Mac, also allow Screen & System Audio Recording, then restart SteveNola.

## How it works

```
Renderer (React)                        Main process (Node)                    Services
────────────────                        ───────────────────                    ────────
Start ───────────── recording:start ──▶ arm capture; per source      ─────────▶ Whisper in a utility
getUserMedia (mic)                      (mic / system): cut audio               process, on this
getDisplayMedia (system loopback)       into utterances at pauses               computer (default),
AudioWorklet → 16 kHz PCM ── audio ──▶                              ◀───────── or Deepgram (optional)
transcript view ◀────── transcript ───  save final segments to disk
Enhance / Ask ─────────── ai:* ───────▶ build prompt from notes +   ─────────▶ Claude, OpenAI, Gemini,
streamed markdown ◀────── ai:event ───  transcript, stream reply    ◀───────── OpenRouter, Ollama, …
```

- **Two separate audio streams.** Your microphone and the system audio (everyone else on the call) are captured and transcribed separately, so the transcript knows "Me" from "Them". System audio is also diarized, so several remote voices show up as Speaker 1, 2, and so on.
- **Listens only while recording.** The main process refuses every microphone and system-audio request unless a recording is armed ([src/main/media.ts](src/main/media.ts)). Stopping releases the devices, closes the transcription streams and disarms capture. While recording, the tray icon is a red dot (a hollow ring otherwise). Closing the window mid-meeting keeps recording, and a notification tells you so.
- **System audio without drivers.** Windows uses WASAPI loopback through Chromium. macOS 13+ uses ScreenCaptureKit (or a Core Audio tap on 14.2+), turned on with Chromium feature switches. In both cases the app asks for display media, keeps the audio track and throws the video away.
- **Your notes drive the AI notes.** Enhance sends your typed notes, the transcript and a structure template (General, 1:1, Customer call, Standup, Interview) to the AI. Every structure opens with a short summary. Prompts are in [src/main/ai/prompts.ts](src/main/ai/prompts.ts).
- **A summary and title when the meeting ends.** When a recording stops (the Stop button, the tray, or the call ending), SteveNola writes the notes in the background, even with the window closed, and they stream into the Enhanced tab. It then asks the AI for a short title, used only if the meeting is untitled, still named after its call ("WhatsApp call"), or was named by the AI earlier. It skips recordings with only a few words, and if you record more later it rewrites the notes and title to cover the whole meeting. Notes you've edited by hand are never replaced, and a title you've typed is never changed. If SteveNola quits before the summary is written, it finishes it the next time it starts. Turn it off in Settings → AI ([src/main/ai/index.ts](src/main/ai/index.ts)).
- **Local storage.** Meetings are JSON files in the app's data folder (Settings → Privacy → Open data folder). Audio is never written to disk. API keys are saved as soon as you paste them and encrypted with Electron's `safeStorage`: Windows data protection (DPAPI, tied to your Windows account) or the macOS Keychain. They're never stored as plain text, shown again, or sent anywhere except to that provider.

## Share notes by email (Gmail)

**Share → Email with Gmail…** opens a dialog with recipients, subject, what to include (enhanced notes, your own notes, the transcript) and a preview. **Open in Gmail** opens a ready-to-send Gmail draft in your browser; nothing is sent until you press Send there. No Google sign-in or API access is needed from the app ([src/main/share.ts](src/main/share.ts)).

- Gmail compose links carry plain text only, so the body is formatted for that: headings in capitals, bullets, ☐ for action items ([src/shared/email.ts](src/shared/email.ts)).
- If the notes are too long for a link, the draft opens with the subject and recipients, and the full notes are put on your clipboard **with formatting**. Paste them into the draft.
- **Copy for email** puts formatted notes (headings, bullets) on the clipboard for any mail app. **Copy as Markdown** is for docs, Slack and wikis.
- In the **Ask** panel, every answer has **Open in Gmail**: ask for "a follow-up email to everyone" and send it in two clicks. A leading `Subject:` line becomes the email subject.
- Settings → Sharing picks the Gmail account (if you're signed in to several) and the greeting line.

## Call detection

When WhatsApp, Zoom, Microsoft Teams, Slack, Discord, FaceTime, Skype or Webex starts using your microphone, or a Google Meet, Teams, Zoom or Webex call starts in your browser, SteveNola shows a notification and a banner: **"WhatsApp call in progress. Record call / Not now."** It never records without that yes. Choosing Record creates a "WhatsApp call" meeting and starts recording. When the call ends, recording stops (Settings → Calls has both switches), and the summary and a better title are written.

SteveNola has to be running to notice calls. Closing the window leaves it in the tray (the menu bar on a Mac), and the installed app can start there when you log in (Settings → Calls).

Detection reads which apps are using the mic, never audio ([src/main/calls/](src/main/calls)):

- **Windows:** a small PowerShell script ([native/win/call-monitor.ps1](native/win/call-monitor.ps1)) reads Core Audio's list of audio sessions, the same list the volume mixer shows, every 1.5 seconds, and reports which programs are capturing from a microphone. WhatsApp and the new Teams capture in a WebView2 helper process, so the script also reports each program's parent processes. As a fallback SteveNola also reads the per-app microphone usage that Windows keeps in the registry, which some Windows 11 builds stopped updating. Works for Microsoft Store apps and desktop apps alike.
- **macOS:** a small Swift helper ([native/mac/call-monitor.swift](native/mac/call-monitor.swift)) reads Core Audio's per-process input state (macOS 14.2+). On macOS 13–14.1 it can only tell that *some* app is using the mic, so it assumes a running call app is the one. In that mode the recording can't stop itself when the call ends, and browser calls aren't detected. `npm run dist:mac` builds the helper; for `npm run dev` on a Mac, run `npm run helper:mac` once first.
- **Browser calls:** a browser using the mic could be doing anything, so SteveNola then checks the titles of open windows. A browser window's title is its current tab ("Meet - abc-defg-hij - Google Chrome"). Titles are only read while a browser holds the mic, only checked for a call, and never saved or sent anywhere. Once found, the call lasts until the browser lets go of the mic, so switching tabs doesn't end it. The Meet tab must be the visible tab of a window that isn't minimized when the call starts, or when you switch back to it. A Meet window's title is unique, so Meet is also found in the installed Meet app and on a Mac. Teams, Zoom and Webex windows look the same as their desktop apps', so those web calls are only recognised in a Windows browser window. On a Mac, reading window titles needs the Screen & System Audio Recording permission.

Recording laws differ by country and state. Some require everyone's consent, so the prompt reminds you to tell people you're recording.

## Choose your AI

Pick the provider and model in **Settings → AI for notes and questions**. **Load models** lists the models your key can use.

| Provider | What you need |
|---|---|
| Claude (Anthropic), the default | API key, or `ANTHROPIC_API_KEY`. Default model `claude-opus-5-5`. |
| OpenAI | API key, or `OPENAI_API_KEY` |
| Google Gemini | API key, or `GEMINI_API_KEY` |
| OpenRouter | One key for models from many providers, or `OPENROUTER_API_KEY` |
| Ollama | Nothing: runs locally, and notes never leave your computer. Default URL `http://localhost:11434/v1` |
| Other OpenAI-compatible API | Base URL plus an optional key: LM Studio, Groq, Mistral, DeepSeek, vLLM, … |

Claude goes through the official `@anthropic-ai/sdk`, with prompt caching on the meeting context and server-side refusal fallback ([src/main/ai/anthropic.ts](src/main/ai/anthropic.ts)). Every other provider uses the OpenAI Chat Completions streaming format ([src/main/ai/openai-compatible.ts](src/main/ai/openai-compatible.ts)). To add a provider with a different API, implement `AiClient` in [src/main/ai/types.ts](src/main/ai/types.ts) and add it to `clientFor` in [src/main/ai/index.ts](src/main/ai/index.ts).

## Transcription

Built in by default: OpenAI's open Whisper speech-recognition model runs on your computer through Transformers.js and ONNX Runtime ([src/main/transcription/](src/main/transcription)). No account or key is needed, and audio never leaves the machine.

- **How it works:** each source's audio is cut into utterances at pauses ([segmenter.ts](src/main/transcription/segmenter.ts)), and each utterance is transcribed in a separate utility process, so the app never freezes. While someone is mid-sentence, a rough partial result shows with animated dots. It's replaced by the final text when they pause.
- **Model download:** on your first recording, SteveNola downloads the model from Hugging Face (about 130 MB) and keeps it in the app's data folder; after that it works offline. Settings → Transcription → **Download now** fetches it in advance.
- **Model sizes:** Fastest (tiny), Balanced (base, default) and Most accurate (small). English uses the English-only models, which are more accurate.
- **Speed:** measured on the development PC, the Balanced model took about 1 second per spoken sentence, faster than real time. If a slow computer falls behind, the recording bar says so and the transcript catches up.
- **Deepgram:** still available as an optional cloud engine in Settings → Transcription. It needs an API key, or `DEEPGRAM_API_KEY`.

While recording, the **Me** and **Them** chips in the recording bar and at the top of the transcript move with each voice and glow green while that person is talking, so you can see it's hearing both sides. SteveNola transcribes as you go, but by default the transcript only appears when you stop recording; Settings → Transcription → **Show the transcript while recording** shows it live.

## Develop

[Install and run](#install-and-run) covers setup and `npm run dev`. Other scripts:

- `npm run typecheck` checks the TypeScript.
- `npm run build` type-checks and bundles the app into `out/`.
- `npm start` runs the bundled app without the dev server.
- `npm run icons` regenerates the app icon in `build/`.
- `npm run helper:mac` builds the Mac call-detection helper; it needs Xcode 15.1+ command line tools.

### Publish a release

GitHub builds both installers and publishes the release ([.github/workflows/release.yml](.github/workflows/release.yml)). Set the new version in `package.json`, commit and push it, then push a matching tag:

```bash
git tag v0.1.0
```

```bash
git push origin v0.1.0
```

About 10 minutes later, the Windows and Mac installers appear on the [Releases](https://github.com/SteveDeveloperConcepts/SteveNola/releases) page. To test the builds without releasing, run the **Release** workflow by hand from the Actions tab; its installers are attached to the run.

## Permissions

- **macOS:** Microphone, plus **Screen & System Audio Recording** for the other participants. macOS prompts the first time you record; you can also review both under Settings → Permissions.
- **Windows:** Settings → Privacy & security → Microphone → *Let desktop apps access your microphone* must be on. System audio needs no permission.

## Design

The screens follow the **SteveNola Screens** design canvas: https://claude.ai/artifact/73Y38mAGeuAWi2iGGZF2aJ (recording, enhanced notes and the Share menu, the Gmail dialog, Settings, and the call prompt). Colors and components in [src/renderer/src/styles.css](src/renderer/src/styles.css) match it.

## Known limitations

- Without headphones, your mic also picks up the other participants from your speakers, so their words can appear twice (once as "Me"). Echo cancellation reduces this but doesn't remove it.
- Built-in transcription on macOS needs an Apple Silicon Mac: ONNX Runtime 1.30 ships no Intel-Mac build. On Intel Macs, use Deepgram.
- Built-in transcription labels everyone on the call "Them". Separating several remote voices (Speaker 1, 2, …) works only with Deepgram.
- No calendar integration. Browser calls are recognised by window title, so only Google Meet (and, in a Windows browser, Teams, Zoom and Webex) are detected, and only when their tab is showing at some point during the call.
- The macOS call-detection helper hasn't been compiled or run yet (it was written on Windows).
