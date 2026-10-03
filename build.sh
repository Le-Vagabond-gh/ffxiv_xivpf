#!/bin/sh
# Local build: keeps Gradle's per-project cache out of the OneDrive tree too.
# Usage: ./build.sh [gradle tasks...]   (default: installDebug)
cd "$(dirname "$0")" || exit 1
export JAVA_HOME="${JAVA_HOME:-$HOME/Android/jdk-21.0.12.1+1}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/sdk}"
[ $# -eq 0 ] && set -- installDebug
exec ./gradlew --project-cache-dir "$HOME/.cache/xivpf-android/gradle" -Pkotlin.project.persistent.dir="$HOME/.cache/xivpf-android/kotlin" "$@"
