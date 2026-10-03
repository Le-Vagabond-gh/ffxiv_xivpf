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
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}
