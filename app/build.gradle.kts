plugins {
    id("com.android.application")
}

android {
    namespace = "com.levagabond.xivpf"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.levagabond.xivpf"
        minSdk = 26
        targetSdk = 36
        // CI passes -PversionCode=<run number> -PversionName=1.1.<run number>
        versionCode = (findProperty("versionCode") as String?)?.toInt() ?: 1
        versionName = findProperty("versionName") as String? ?: "1.1.0"
    }

    sourceSets {
        // the page core and game data are shared with the userscript
        getByName("main").assets.directories.add("../shared")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}
