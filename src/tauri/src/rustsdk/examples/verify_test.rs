use std::path::Path;

fn main() {
    let pub_key_path = Path::new("rustsdk/public_key.bin");
    let pub_key_bytes = std::fs::read(pub_key_path).expect("cannot read rustsdk/public_key.bin");

    let license_code = "HQAAAMDum2oAAAAAEQAAAEF1dGhvcml6YXRpb25Ub29sHkEsFu5ywhsg5UCgUsPQqn5XPuR3a9hYBwAcXCv2T6LEXl2ANosZjVpKdMNu92zGjDLzktbglDt+Mb1V/4u91Q==";

    println!("=== Rust SDK Verification Test ===");
    println!("Public key size: {} bytes", pub_key_bytes.len());
    println!("License code: {}", license_code);
    println!();

    match license_verify::verify_license(&pub_key_bytes, license_code) {
        Ok(info) => {
            println!("VERIFY PASSED!");
            println!("Hardware ID: {}", info.hardware_id);
            println!("Apply timestamp: {}", info.apply_timestamp);
            println!("Product name: {}", info.product_name);
            println!("Expiry timestamp: {}", info.expiry_timestamp);

            // Format expiry time
            let expiry_secs = info.expiry_timestamp as i64;
            let days = expiry_secs / 86400;
            let time_of_day = expiry_secs % 86400;
            let hours = time_of_day / 3600;
            let minutes = (time_of_day % 3600) / 60;
            let seconds = time_of_day % 60;
            println!("Expiry: day {} {:02}:{:02}:{:02} (unix timestamp)", days, hours, minutes, seconds);
        }
        Err(e) => {
            println!("VERIFY FAILED: {}", e);
        }
    }
}
