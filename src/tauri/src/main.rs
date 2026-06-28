#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};
use base64::Engine;
use license_verify::LicenseInfo;

const PRODUCT_NAME: &str = "UnderFlow";

#[derive(Debug, Serialize, Deserialize)]
struct LicenseData {
    license_code: String,
    machine_id: String,
    expiry_timestamp: i64,
    product_name: String,
}

#[derive(Debug, Serialize)]
struct LicenseStatus {
    is_registered: bool,
    expiry_timestamp: Option<i64>,
    days_remaining: Option<i64>,
    product_name: Option<String>,
    machine_id: String,
}

#[tauri::command]
fn save_flowchart(path: String, data: String) -> Result<(), String> {
    fs::write(&path, data).map_err(|e| format!("Failed to save: {}", e))
}

#[tauri::command]
fn load_flowchart(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to load: {}", e))
}

#[tauri::command]
fn save_file_dialog(default_name: String) -> Result<Option<String>, String> {
    let file = rfd::FileDialog::new()
        .add_filter("UnderFlow", &["uflow"])
        .set_file_name(&default_name)
        .save_file();
    Ok(file.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
fn open_file_dialog() -> Result<Option<String>, String> {
    let file = rfd::FileDialog::new()
        .add_filter("UnderFlow", &["uflow"])
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

fn get_app_data_dir() -> Result<std::path::PathBuf, String> {
    let dir = dirs::data_local_dir()
        .ok_or_else(|| "Cannot get local data directory".to_string())?
        .join("UnderFlow");
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create data directory: {}", e))?;
    Ok(dir)
}

fn get_license_file_path() -> Result<std::path::PathBuf, String> {
    Ok(get_app_data_dir()?.join("license.json"))
}

/// Get machine ID from Windows registry: HKLM\SOFTWARE\Microsoft\SQMClient\MachineId
fn get_machine_id_internal() -> String {
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        if let Ok(key) = hklm.open_subkey("SOFTWARE\\Microsoft\\SQMClient") {
            if let Ok(id) = key.get_value::<String, _>("MachineId") {
                return id;
            }
        }
    }
    // Fallback: use hostname + username
    let hostname = std::env::var("COMPUTERNAME").unwrap_or_default();
    let username = std::env::var("USERNAME").unwrap_or_default();
    format!("fallback-{}-{}", hostname, username)
}

#[tauri::command]
fn get_machine_id() -> String {
    get_machine_id_internal()
}

#[tauri::command]
fn get_apply_code() -> String {
    let machine_id = get_machine_id_internal();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let data = format!("{}|{}", machine_id, now);
    base64::engine::general_purpose::STANDARD.encode(data.as_bytes())
}

#[tauri::command]
fn get_ntp_time() -> Result<i64, String> {
    let client = reqwest::blocking::Client::new();
    let response = client.get("http://worldtimeapi.org/api/timezone/Asia/Shanghai")
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .map_err(|e| format!("NTP request failed: {}", e))?;
    
    let json: serde_json::Value = response.json().map_err(|e| format!("Failed to parse NTP response: {}", e))?;
    let timestamp = json["unixtime"].as_i64().ok_or_else(|| "No unixtime in NTP response".to_string())?;
    Ok(timestamp)
}

#[tauri::command]
fn verify_license_code(license_code: String) -> Result<LicenseInfo, String> {
    let sdk_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join("rustsdk");
    let pub_key_path = sdk_dir.join("public_key.bin");
    
    let pub_key_bytes = fs::read(&pub_key_path)
        .map_err(|e| format!("Cannot read public key: {}", e))?;
    
    let info = license_verify::verify_license(&pub_key_bytes, &license_code)
        .map_err(|e| format!("Verification failed: {}", e))?;
    
    // Verify machine ID matches
    let machine_id = get_machine_id_internal();
    if info.hardware_id != machine_id {
        return Err("Machine ID mismatch, this license is not for this device".to_string());
    }
    
    // Verify product name
    if info.product_name != PRODUCT_NAME {
        return Err(format!("Product mismatch: expected '{}', got '{}'", PRODUCT_NAME, info.product_name));
    }
    
    Ok(info)
}

#[tauri::command]
fn save_license(license_code: String) -> Result<(), String> {
    let sdk_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join("rustsdk");
    let pub_key_path = sdk_dir.join("public_key.bin");
    
    let pub_key_bytes = fs::read(&pub_key_path)
        .map_err(|e| format!("Cannot read public key: {}", e))?;
    
    let info = license_verify::verify_license(&pub_key_bytes, &license_code)
        .map_err(|e| format!("Verification failed: {}", e))?;
    
    let machine_id = get_machine_id_internal();
    if info.hardware_id != machine_id {
        return Err("Machine ID mismatch".to_string());
    }
    
    if info.product_name != PRODUCT_NAME {
        return Err(format!("Product mismatch: expected '{}'", PRODUCT_NAME));
    }
    
    let license_data = LicenseData {
        license_code,
        machine_id,
        expiry_timestamp: info.expiry_timestamp,
        product_name: info.product_name,
    };
    
    let json = serde_json::to_string(&license_data).map_err(|e| format!("Failed to serialize license: {}", e))?;
    let path = get_license_file_path()?;
    fs::write(&path, json).map_err(|e| format!("Failed to save license: {}", e))
}

#[tauri::command]
fn get_license_status() -> Result<LicenseStatus, String> {
    let machine_id = get_machine_id_internal();
    let path = get_license_file_path()?;
    
    if !path.exists() {
        return Ok(LicenseStatus {
            is_registered: false,
            expiry_timestamp: None,
            days_remaining: None,
            product_name: None,
            machine_id,
        });
    }
    
    let json = fs::read_to_string(&path).map_err(|e| format!("Failed to read license: {}", e))?;
    let license_data: LicenseData = serde_json::from_str(&json).map_err(|e| format!("Failed to parse license: {}", e))?;
    
    if license_data.machine_id != machine_id {
        return Ok(LicenseStatus {
            is_registered: false,
            expiry_timestamp: None,
            days_remaining: None,
            product_name: None,
            machine_id,
        });
    }
    
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    
    if license_data.expiry_timestamp < now {
        return Ok(LicenseStatus {
            is_registered: false,
            expiry_timestamp: None,
            days_remaining: None,
            product_name: None,
            machine_id,
        });
    }
    
    let days_remaining = (license_data.expiry_timestamp - now) / 86400;
    
    Ok(LicenseStatus {
        is_registered: true,
        expiry_timestamp: Some(license_data.expiry_timestamp),
        days_remaining: Some(days_remaining),
        product_name: Some(license_data.product_name),
        machine_id,
    })
}

#[tauri::command]
fn reset_license() -> Result<(), String> {
    let path = get_license_file_path()?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to remove license: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", &url])
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }
    #[cfg(not(windows))]
    {
        open::that(&url).map_err(|e| format!("Failed to open URL: {}", e))?;
    }
    Ok(())
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
            get_machine_id,
            get_apply_code,
            get_ntp_time,
            verify_license_code,
            save_license,
            get_license_status,
            reset_license,
            open_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
