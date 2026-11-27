use tauri::{AppHandle, Emitter};

/// Запускает фоновый слушатель глобальных горячих клавиш (Windows):
/// - Ctrl + Alt + Space : Play / Pause
/// - Ctrl + Alt + Right : Следующий трек
/// - Ctrl + Alt + Left  : Предыдущий трек
pub fn start_global_hotkeys(app: AppHandle) {
    #[cfg(target_os = "windows")]
    std::thread::spawn(move || {
        use std::mem::zeroed;

        const MOD_ALT: u32 = 0x0001;
        const MOD_CONTROL: u32 = 0x0002;
        const MOD_NOREPEAT: u32 = 0x4000;
        const WM_HOTKEY: u32 = 0x0312;

        const VK_SPACE: u32 = 0x20;
        const VK_LEFT: u32 = 0x25;
        const VK_RIGHT: u32 = 0x27;

        const ID_TOGGLE: i32 = 1;
        const ID_NEXT: i32 = 2;
        const ID_PREV: i32 = 3;

        #[repr(C)]
        struct POINT {
            x: i32,
            y: i32,
        }

        #[repr(C)]
        struct MSG {
            hwnd: isize,
            message: u32,
            w_param: usize,
            l_param: isize,
            time: u32,
            pt: POINT,
        }

        #[link(name = "user32")]
        extern "system" {
            fn RegisterHotKey(h_wnd: isize, id: i32, fs_modifiers: u32, vk: u32) -> i32;
            fn UnregisterHotKey(h_wnd: isize, id: i32) -> i32;
            fn GetMessageW(lp_msg: *mut MSG, h_wnd: isize, min: u32, max: u32) -> i32;
        }

        let mods = MOD_CONTROL | MOD_ALT | MOD_NOREPEAT;
        unsafe {
            let _ = RegisterHotKey(0, ID_TOGGLE, mods, VK_SPACE);
            let _ = RegisterHotKey(0, ID_NEXT, mods, VK_RIGHT);
            let _ = RegisterHotKey(0, ID_PREV, mods, VK_LEFT);

            let mut msg: MSG = zeroed();
            while GetMessageW(&mut msg, 0, 0, 0) > 0 {
                if msg.message == WM_HOTKEY {
                    match msg.w_param as i32 {
                        ID_TOGGLE => {
                            let _ = app.emit("media-control", "toggle");
                        }
                        ID_NEXT => {
                            let _ = app.emit("media-control", "next");
                        }
                        ID_PREV => {
                            let _ = app.emit("media-control", "previous");
                        }
                        _ => {}
                    }
                }
            }

            let _ = UnregisterHotKey(0, ID_TOGGLE);
            let _ = UnregisterHotKey(0, ID_NEXT);
            let _ = UnregisterHotKey(0, ID_PREV);
        }
    });

    #[cfg(not(target_os = "windows"))]
    let _ = app;
}
