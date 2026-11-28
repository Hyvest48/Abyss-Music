fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        // Линкуем C++ stdlib и ABI статически для oboe-sys (иначе на Android не находится __cxa_pure_virtual и др.)
        println!("cargo:rustc-cdylib-link-arg=-lc++_static");
        println!("cargo:rustc-cdylib-link-arg=-lc++abi");
    }
    tauri_build::build();
}
