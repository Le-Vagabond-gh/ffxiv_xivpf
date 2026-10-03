## xivpf - party finder alerts for Android
A phone version of the xivpf party finder page, with notifications for new listings.

**Author:** Le Vagabond

## Installation
- Build locally with `./build.sh` (needs the Android SDK and a JDK, see `build.sh` for the expected paths) - it builds the debug APK and installs it on the connected device
- Or build the APK only with `./build.sh assembleDebug` and sideload `~/.cache/xivpf-android/build/app/outputs/apk/debug/app-debug.apk`

## Usage
The page shows the current party finder listings from xivpf.com, filtered by:
- region or data centre
- categories (collapsible list, with all / none shortcuts)
- free text search over duty, description, recruiter and worlds

Filters are remembered between launches.

- **auto-refresh / every** - reload the list on the chosen interval (1 to 30 minutes), or tap `refresh` for an immediate reload
- **alerts** - start watching in the background: a notification is posted for every listing that newly matches the current filters, checked on the same interval. A persistent "xivpf alerts on" notification shows how many listings currently match and has a Stop button. Alerts keep running when the app is closed until stopped.

Changing a filter while alerts are on resets the baseline: listings already visible under the new filter do not alert, only ones appearing after that.

The first time alerts are enabled the app asks to be excluded from battery optimisation so the checks keep running with the screen off.
