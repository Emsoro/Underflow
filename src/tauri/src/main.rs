#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;

#[tauri::command]
fn save_flowchart(path: String, data: String) -> Result<(), String> {
    fs::write(&path, data).map_err(|e| format!("Failed to save: {}", e))
}

#[tauri::command]
fn load_flowchart(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to load: {}", e))
}

#[tauri::command]
fn save_file_dialog() -> Result<Option<String>, String> {
    let file = rfd::FileDialog::new()
        .add_filter("Flowchart JSON", &["json"])
        .set_file_name("flowchart.json")
        .save_file();
    Ok(file.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
fn open_file_dialog() -> Result<Option<String>, String> {
    let file = rfd::FileDialog::new()
        .add_filter("Flowchart JSON", &["json"])
        .pick_file();
    Ok(file.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
fn save_image_dialog(default_name: String, filter_name: String, extensions: Vec<String>) -> Result<Option<String>, String> {
    let ext_refs: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
    let file = rfd::FileDialog::new()
        .add_filter(&filter_name, &ext_refs)
        .set_file_name(&default_name)
        .save_file();
    Ok(file.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
fn save_binary_file(path: String, base64_data: String) -> Result<(), String> {
    use std::io::Write;
    let decoded = base64_decode(&base64_data);
    let mut file = fs::File::create(&path).map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(&decoded).map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
fn save_text_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| format!("Failed to write file: {}", e))
}

fn base64_decode(data: &str) -> Vec<u8> {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let data = data.trim_end_matches('=');
    let mut result = Vec::with_capacity(data.len() * 3 / 4);
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for &byte in data.as_bytes() {
        let val = CHARS.iter().position(|&c| c == byte).unwrap_or(0) as u32;
        buf = (buf << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            result.push((buf >> bits) as u8);
        }
    }
    result
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            save_flowchart,
            load_flowchart,
            save_file_dialog,
            open_file_dialog,
            save_image_dialog,
            save_binary_file,
            save_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
