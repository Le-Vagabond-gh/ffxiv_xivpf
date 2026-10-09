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
        versionCode = 2
        versionName = "1.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}
