plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.gms.google-services")
}

android {
    namespace = "com.amethos.mytechkid"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.amethos.mytechkid"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "0.1.${System.getenv("GITHUB_RUN_NUMBER") ?: "0"}-beta"
    }

    signingConfigs {
        // Beta-only key so each new build installs over the last one.
        // Replace with a private key (kept out of git) before any public release.
        create("beta") {
            storeFile = file("beta.keystore")
            storePassword = "fam-beta"
            keyAlias = "fam-beta"
            keyPassword = "fam-beta"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("beta")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-auth")
    implementation("com.google.firebase:firebase-firestore")
    implementation("com.google.firebase:firebase-functions")
    implementation("com.google.firebase:firebase-messaging")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")

    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.core:core-ktx:1.15.0")
    // Screen sharing: Google's WebRTC, packaged for Android (ScreenShareService.kt).
    implementation("io.getstream:stream-webrtc-android:1.3.10")
}
