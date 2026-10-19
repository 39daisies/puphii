# Voice Pep Rally — Native Recording and Audio Import Acceptance Contract

**Release scope:** Puphii 1.0. Both recording inside Puphii and importing existing audio are mandatory. No cloud media service.

## Entry points and UI
- Voice Pep Rally library: **Record a message** and **Import audio** equally discoverable.
- Import via iOS Files document picker. Accept accessible audio files exported from Voice Memos, Files, and other recording apps. Explain that a recording still inside Voice Memos must first be shared/exported to Files or opened through the iOS share flow; do not claim direct access to the Voice Memos private library.
- Show an import preview with title, duration, file type, and a playable preview before Save. Permit cancel without changing library.
- For someone else's voice, require explicit confirmation that the user has permission to use the recording. No consent checkbox required for user's own voice.
- Support rename, play/pause, delete, and easy playback during an urge. Accessible VoiceOver labels, Dynamic Type, and permission-denied messaging.
- Do not request microphone permission for importing or playing existing files. Request it only when recording begins.

## Accepted input and validation
- Existing model supports `PepSource = 'microphone' | 'import'`, and extensions `m4a, aac, caf, wav, mp3, aiff`. Use those only where actual iOS decoding and metadata probing succeeds; do not trust extension/MIME alone.
- Audio only; reject video, unsupported or corrupt files, and inaccessible security-scoped URLs with an actionable message.
- Limit each recording/import to **60 seconds** (plus the controller's existing tolerance only for recorder timing), and **50 saved recordings**. Do not silently truncate longer imports; offer the user a clear unsupported-length message. No built-in trimming required for v1.
- Apply a reasonable file-size ceiling after examining the codec and memory/disk impact; validate actual bytes and playback, not filename. Report the ceiling in UI if enforced.
- Imported filenames are untrusted. Generate a new app-owned staged filename using `src/pepRally/files.ts`; never retain a user-controlled filename as a filesystem path.
- Copy the picked source into private staging; never move or delete the source file from Files/Voice Memos/iCloud Drive. A source in iCloud Drive may be downloaded by the document picker, but Puphii does not upload it.
- After validation, save using the existing `createPepRallyController` take/import and media-store lifecycle. Use the same atomic adoption, SHA-256 identity, verified per-file backup exclusion, recovery and cleanup rules as microphone recordings.
- If source access expires, the user cancels, storage fails, or the app is interrupted, remove staged copies and leave the original file untouched.
- Ensure app reset deletes both imported and microphone-created local media, and that deletions/recovery do not affect original external files.

## Native implementation
- Connect `PepMediaStore` to real iOS storage and implement the native recorder/player. Audit Expo SDK versions and APIs rather than assuming older interfaces.
- Use a supported document-picker flow with copy-to-cache or temporary access, then copy into Puphii staging. Handle security-scoped resource access and iCloud downloads as applicable.
- Enforce media backup-exclusion verification on each saved file; if the current Expo file APIs cannot provide the required read-back, use an appropriate native capability rather than weakening the existing controller contract.
- Preserve the subscription-only entitlement gate. Audit obsolete free-tier access rules and update callers/tests coherently. All subscribers have the same 50-item/60-second allowance.
- Do not introduce audio transcription, voice cloning, AI voices, analytics, or remote audio upload.

## Test matrix
- Microphone recording and file import each create a playable saved Pep Rally.
- Import common Voice Memos .m4a, Files .mp3, and .wav; reject malformed files, video, files over 60 seconds, inaccessible URLs, unsupported formats, and zero-byte files.
- Cancel picker; deny microphone permission; import without microphone permission; import someone else's voice with and without permission confirmation.
- Verify no modification to the original imported file.
- Verify library cap, rename/delete, playback after app relaunch, offline playback, app reset cleanup, import interruption recovery, and per-file backup-exclusion read-back.
- Unit tests for validation and controller integration; physical iPhone tests for document picker, Voice Memos export, Files/iCloud Drive, microphone, and interruptions.

## Publication impact
Privacy Policy and Terms must explicitly cover both **recorded** and **imported** audio, including other people's voices, user permission, local storage, backup behavior, and deletion. Keep policies as drafts until actual native behavior is verified.
