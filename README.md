# xivpf - lightweight party finder page

a faster view of the [xivpf.com](https://xivpf.com) party finder listings, as a browser userscript and as an Android app with notifications for new listings. both run the same page: `shared/` holds it, `userscript/` and `app/` only wire it to their platform.

**Author:** Le Vagabond

## the page

listings from xivpf.com, filtered by:
- region or data centre
- categories (collapsible list, with all / none shortcuts)
- specific duties (collapsible list of the duties currently listed, grouped by category; nothing checked shows all)
- free text search over duty, description, recruiter and worlds

filters are remembered. `clear filters` puts every category back and drops the duty selection. `refresh` reloads now, `auto` reloads `every` 1 to 30 minutes (5 by default: the listings come as one 1.5 MB blob with no server-side filter, so go easy on it). the recruiter name links to their tomestone.gg profile.

the data is xivpf.com's, the footer has its donation links.

## userscript

install [xivpf-pf.user.js](https://raw.githubusercontent.com/Le-Vagabond-gh/ffxiv_xivpf/main/userscript/xivpf-pf.user.js) in Tampermonkey or Violentmonkey, then open https://xivpf.com/pf. updates come from this repo.

## android

grab the APK from the [latest release](https://github.com/Le-Vagabond-gh/ffxiv_xivpf/releases/latest) and sideload it. minimum Android 8.

on top of the page, `alerts` watches in the background: a notification for every listing that newly matches the current filters, checked on the `every` interval. a persistent "xivpf alerts on" notification shows how many listings currently match and has a Stop button. alerts keep running when the app is closed until stopped.

changing a filter while alerts are on resets the baseline: listings already visible under the new filter do not alert, only ones appearing after that.

the first time alerts are enabled the app asks to be excluded from battery optimisation so the checks keep running with the screen off.

### build

JDK 21 and Android SDK 36, then `./build.sh` builds the debug APK and installs it on the connected device (see `build.sh` for the expected tool paths). `./build.sh assembleDebug` only builds, the APK is in `~/.cache/xivpf-android/build/app/outputs/apk/debug/`.
