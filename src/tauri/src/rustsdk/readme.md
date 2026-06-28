# License Verify SDK (Rust)

授权码验证 Rust SDK，用于在 Rust 应用中验证 AuthorizationTool 生成的授权码。

**安全方案**：ECDSA P-256 数字签名，客户端只需公钥即可验证，私钥不会分发。

## 依赖

- `p256` - ECDSA P-256 签名验证
- `base64` - Base64 解码
- `sha2` - SHA-256 哈希

## 快速使用

### 1. 添加依赖

在 `Cargo.toml` 中添加：

```toml
[dependencies]
license-verify = { path = "../rustsdk" }
```

### 2. 验证授权码

```rust
use license_verify::{verify_license, verify_license_from_file};

fn main() {
    // 方式一：从文件读取公钥
    let result = verify_license_from_file(
        std::path::Path::new("rustsdk/public_key.bin"),
        "用户提供的Base64授权码",
    );

    // 方式二：直接传入公钥字节
    // let pub_key_bytes = std::fs::read("rustsdk/public_key.bin").unwrap();
    // let result = verify_license(&pub_key_bytes, "授权码");

    match result {
        Ok(info) => {
            println!("硬件ID: {}", info.hardware_id);
            println!("申请时间戳: {}", info.apply_timestamp);
            println!("产品名称: {}", info.product_name);
            println!("过期时间戳: {}", info.expiry_timestamp);

            // 1. 检查是否过期
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64;
            if info.expiry_timestamp < now {
                println!("授权已过期");
            } else {
                println!("授权有效");
            }

            // 2. 检查硬件ID是否匹配（可选，用于增强安全性）
            let current_hardware_id = get_current_machine_id();
            if info.hardware_id != current_hardware_id {
                println!("硬件ID不匹配，授权码不能在当前机器使用");
            }
        }
        Err(e) => {
            eprintln!("验证失败: {}", e);
        }
    }
}

// 获取当前机器的硬件ID（需要根据实际情况实现）
fn get_current_machine_id() -> String {
    // TODO: 实现获取当前机器硬件ID的逻辑
    "XXXXXXXXXXXX".to_string()
}
```

## 授权码格式

授权码为 Base64 编码字符串，解码后二进制结构：

```
[4字节 dataLen]           - 授权数据长度 (little-endian uint32)
[dataLen字节 授权数据]     - 明文授权数据
[64字节 签名]              - ECDSA P-256 原始签名 (R||S, 各32字节)
```

## 授权数据结构

授权数据包含以下4个字段，按顺序紧凑排列：

```
[4字节 hardware_id_len] [N字节 hardware_id] [8字节 apply_timestamp] [4字节 product_name_len] [M字节 product_name] [8字节 expiry_timestamp]

字段说明：
- hardware_id_len: 硬件ID字符串长度 (uint32_t, little-endian)
- hardware_id: 硬件ID字符串 (UTF-8)，用于绑定特定机器
- apply_timestamp: 申请时间戳 (int64_t, little-endian, Unix时间戳)
- product_name_len: 产品名称字符串长度 (uint32_t, little-endian)
- product_name: 产品名称字符串 (UTF-8)
- expiry_timestamp: 过期时间戳 (int64_t, little-endian, Unix时间戳)
```

**示例：**
假设：
- hardware_id = "XXXXXXXXXXXX" (12字节)
- apply_timestamp = 1717843200 (2024-06-08 12:00:00)
- product_name = "UnderFlow" (9字节)
- expiry_timestamp = 1720435200 (2024-07-08 12:00:00)

则授权数据总长度 = 4 + 12 + 8 + 4 + 9 + 8 = 45字节

## 公钥文件格式

`public_key.bin` 为 Windows CNG `BCRYPT_ECCPUBLIC_BLOB` 格式：

```
[4字节 magic]  0x31534345 ("ECS1") - ECDSA P-256
[4字节 cbKey]  32 (P-256)
[32字节 X]     公钥 X 坐标
[32字节 Y]     公钥 Y 坐标
```

## 签名与验证流程

### 签名流程（AuthorizationTool 内部，需要私钥）

1. 序列化授权信息（硬件ID + 申请时间 + 产品名 + 过期时间）
2. 对授权数据进行 SHA-256 哈希
3. 使用 ECDSA P-256 私钥对哈希值签名，输出原始 R||S 格式签名（64字节）
4. 组装：`dataLen(4) + 授权数据 + 签名(64)`，Base64 编码

### 验证流程（SDK，只需公钥）

1. Base64 解码授权码
2. 分离授权数据和签名
3. 对授权数据进行 SHA-256 哈希
4. 使用公钥通过 `PrehashVerifier::verify_prehash` 验证 ECDSA 签名（预计算哈希模式）
5. 反序列化授权数据，获取硬件ID、申请时间、产品名和过期时间

## API

### `verify_license(public_key_bytes, license_code)`

- `public_key_bytes: &[u8]` — 公钥文件内容（BCRYPT_ECCPUBLIC_BLOB 格式）
- `license_code: &str` — Base64 编码的授权码
- 返回 `Result<LicenseInfo, VerifyError>`

### `verify_license_from_file(public_key_path, license_code)`

- `public_key_path: &Path` — 公钥文件路径
- `license_code: &str` — Base64 编码的授权码
- 返回 `Result<LicenseInfo, VerifyError>`

### `LicenseInfo`

| 字段 | 类型 | 说明 |
|------|------|------|
| `hardware_id` | `String` | 硬件ID（用于绑定特定机器） |
| `apply_timestamp` | `i64` | 授权申请时间（Unix 时间戳） |
| `product_name` | `String` | 产品名称（UTF-8） |
| `expiry_timestamp` | `i64` | 授权过期时间（Unix 时间戳） |

## 错误类型

| 错误 | 说明 |
|------|------|
| `Base64Error` | Base64 解码失败 |
| `InvalidFormat` | 授权码格式错误 |
| `InvalidPublicKey` | 公钥文件无效 |
| `SignatureError` | 签名验证失败（授权码被篡改或公钥不匹配） |

## 安全说明

- **签名方案**：ECDSA P-256 + SHA-256
- **签名格式**：原始 R||S 格式（64字节，非 DER 编码）
- **私钥**：仅保存在 AuthorizationTool 的 `key/ecc_keypair.bin` 中，不会分发
- **公钥**：`rustsdk/public_key.bin`，可安全分发给客户端
- 拿到公钥的人无法伪造授权码
