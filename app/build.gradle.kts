import java.util.Properties

plugins { id("com.android.application") }

// release 서명 열쇠는 저장소 밖(D:/app/_keys/vec-pleos/keystore.properties)에 둔다. 없으면 release 서명 없이 빌드된다.
val keyProps = Properties().apply {
    val f = file("D:/app/_keys/vec-pleos/keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
// 공개 제출용 빌드(-Ppublic=true): 라이선스 시험 음원(assets/www/_local)을 APK 에서 뺀다. 녹턴은 앱 곡 네 곡으로 듣는다.
val publicBuild = (project.findProperty("public") as String?) == "true"

android {
    namespace = "com.fyostudio.vecpleos"
    compileSdk = 36
    useLibrary("android.car")
    defaultConfig {
        applicationId = "com.fyostudio.vecpleos"
        minSdk = 30
        targetSdk = 36
        versionCode = 2
        versionName = "1.0"
    }
    signingConfigs {
        if (keyProps.containsKey("storeFile")) create("release") {
            storeFile = file(keyProps.getProperty("storeFile"))
            storePassword = keyProps.getProperty("storePassword")
            keyAlias = keyProps.getProperty("keyAlias")
            keyPassword = keyProps.getProperty("keyPassword")
        }
    }
    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    androidResources {
        noCompress += "mp3"
        if (publicBuild) ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:.*:!CVS:!thumbs.db:!picasa.ini:!*~:!_local"
    }
}
dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("ai.pleos.playground:Vehicle:2.3.2")
}
