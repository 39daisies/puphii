# Pep Rally orphaned media: requirements for a future recovery screen

Status: requirements only. Nothing here is implemented in Phase V-A, and no screen exists yet.

## What an orphan is

An orphan is a file directly inside Puphii's media folder (`Documents/pep-rallies/`) whose name Puphii generated (`pr-<id>-a<rev>.<ext>` or `pr-<id>-p<rev>.<ext>`) but which no entry in the Pep Rally metadata (`@puphii/pep-rallies-v1`) lists.

Orphans can appear when:

- the metadata could not be parsed and was set aside as a `-corrupt-` copy, so Puphii started with an empty library;
- an entry was dropped while loading because its id or audio name was unusable, and the original was set aside as an `-invalid-` copy;
- a file was restored from a backup without its metadata.

Files in the folder that Puphii did not name are not orphans and are never shown, restored or deleted.

## What Phase V-A guarantees today

- Orphans are never deleted by launching, recovery, saving, replacing, deleting another recording or clearing puff history.
- Orphans are never restored automatically.
- Every recovery reports them in `health().unlisted`, so a future screen can find them without scanning on its own.
- Only Reset everything, which the person confirms, deletes them, together with every other Pep Rally file.
- The set-aside metadata copies stay in storage until Reset everything removes them.

## Requirements for the recovery screen

### When it appears

1. Offered only when `health().unlisted` contains Puphii-named files. It never appears otherwise.
2. Reached from the Pep Rally library, not as a pop-up at launch. Neutral wording, for example "Some recordings on this device aren't in your library." No alarm, no exclamation marks.

### What it shows

3. One row per recording id, grouping its audio file and any photo file.
4. The approximate recording date, decoded from the id's time part, labelled as approximate.
5. The duration, measured from the file itself, never assumed.
6. Manual playback only, never autoplay. Playing an orphan does not restore it.
7. If a set-aside metadata copy can still be read and mentions the same id, its title and tags may be offered as suggestions. They are never applied without the person confirming them.

### What the person can do

8. **Restore**: adds a new library entry that refers to the existing file names. Files are not moved, renamed or copied, and nothing is overwritten.
9. **Delete**: removes that recording's files one at a time through `deleteRecordingFiles`, after a confirmation that names what will be deleted.
10. **Leave for now**: changes nothing. The orphan stays and is offered again later.
11. There is no "restore all" or "delete all" that runs without a confirmation listing what it affects.

### Rules for restoring

12. Restore needs a new lifecycle step that checks the file names belong to the id being restored (`isMediaOf`), that no existing entry claims them, and that the audio file exists. It is journaled like every other change (written before it takes effect), so an interruption can be finished or undone at the next launch.
13. Whose voice it is was stored in the lost metadata. Before restoring, the person confirms whether it is their voice. If it is someone else's, they confirm the speaker agreed, as when saving a new recording.
14. A restored recording gets the default title unless the person accepts a suggestion or types one.
15. Restored audio longer than 60 seconds plus the recorder allowance cannot be restored as a Pep Rally. It can still be deleted.
16. **Owner decision needed before building it:** whether restoring counts against the Free allowance of one recording. Recommended: restoring is always allowed, because these are recordings the person already saved, and the Free and Pro rules for replacing audio and adding photos, tags and favorites then apply to them as to any other recording.

### Safety and privacy

17. Only files directly inside Puphii's media folder with Puphii-generated names are ever listed, restored or deleted. Folder URIs are checked with `isPepDirectoryUri`, as `attachMedia` does today.
18. Everything stays on the device. Nothing is uploaded, and orphan counts are not sent anywhere.
19. The Reset everything confirmation must say that it also deletes recordings that aren't in the library.

### Tests the implementation must include

- Orphans from corrupt and from partly invalid metadata are listed, grouped by id, and nothing else in the folder is.
- Restoring adds exactly one entry, moves no file, and survives a restart. An interrupted restore is finished or undone at launch.
- Restore refuses names that belong to another id, that another entry already claims, or whose audio file is missing.
- Someone else's voice cannot be restored without the permission confirmation.
- Deleting an orphan removes only its files, and never a file outside the media folder.
- Leaving an orphan changes nothing in storage or on disk.
- Suggestions from set-aside copies are never applied without confirmation.
