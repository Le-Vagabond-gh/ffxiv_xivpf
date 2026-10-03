plugins {
    id("com.android.application") version "9.4.1" apply false
    id("org.jetbrains.kotlin.android") version "2.4.20" apply false
}

// Build outputs go to ~/.cache so a OneDrive-synced checkout never holds generated files.
allprojects {
    layout.buildDirectory.set(File(System.getProperty("user.home"), ".cache/xivpf-android/build/${project.name}"))
}
