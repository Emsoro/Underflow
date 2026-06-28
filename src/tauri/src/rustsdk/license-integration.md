# 授权验证系统集成文档

## 概述

使用 ECDSA P-256 签名验证机制实现产品授权。系统采用离线授权模式：用户获取申请码 → 管理员生成授权码 → 应用本地验证签名。

---

## 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      前端 (Vue 3)                           │
├─────────────────────────────────────────────────────────────┤
│  LicenseDialog.vue          │  license.js (Pinia Store)     │
│  ┌─────────────────────┐    │  ┌─────────────────────────┐  │
│  │ 申请码显示/复制      │◄───│  │ generateRequestCode()   │  │
│  │ 授权码输入框         │───►│  │ verifyLicense()         │  │
│  │ 验证按钮/状态提示    │◄───│  │ checkAuthorization()    │  │
│  │ 到期时间/重置按钮    │    │  │ fetchNtpTime()          │  │
│  └─────────────────────┘    │  └─────────────────────────┘  │
└─────────────────────────────┴───────────────────────────────┘
              │ invoke()                          │
              ▼                                  ▼
┌─────────────────────────────────────────────────────────────┐
│                   Tauri 后端 (Rust)                         │
├─────────────────────────────────────────────────────────────┤
│  lib.rs (Tauri Commands)    │  rustsdk/src/lib.rs           │
│  ┌─────────────────────┐    │  ┌─────────────────────────┐  │
│  │ get_machine_id()    │    │  │ verify_license()        │  │
│  │ verify_license()    │───►│  │ parse_public_key()      │  │
│  │ get_ntp_time()      │    │  │ deserialize_license()   │  │
│  └─────────────────────┘    │  └─────────────────────────┘  │
└─────────────────────────────┴───────────────────────────────┘
```

---

## 前端 UI 设计

### LicenseDialog.vue 组件

| 区域 | 内容 | 交互 |
|------|------|------|
| 申请码区 | 灰色背景框显示 Base64 申请码 | 点击"复制"按钮复制到剪贴板 |
| 分隔线 | `a-divider` | - |
| 授权码区 | `a-textarea` 输入框（3-5行） | 输入授权码 |
| 验证行 | "验证"按钮 + 状态文字 | 点击验证，显示成功/失败提示 |
| 授权信息 | 绿色背景框显示到期时间 | 已授权时显示；过期时文字变红 |
| 重置操作 | "重置"按钮（红色链接） | 清除本地授权状态 |

**关键代码位置**: `src/components/common/LicenseDialog.vue`

```vue
<!-- 核心结构 -->
<a-modal title="授权验证" :width="420">
  <!-- 申请码 -->
  <div class="request-code-box">
    <span>{{ useLicenseStore.requestCode }}</span>
    <a-button @click="copyRequestCode">复制</a-button>
  </div>
  
  <!-- 授权码输入 -->
  <a-textarea v-model:value="inputCode" placeholder="请输入授权码" />
  <a-button type="primary" @click="handleVerify">验证</a-button>
  
  <!-- 到期信息 -->
  <div v-if="useLicenseStore.expiryTimestamp">
    授权到期：{{ useLicenseStore.expiryDate }}
    <a-button danger @click="handleReset">重置</a-button>
  </div>
</a-modal>
```

---

## 前端逻辑 (Pinia Store)

### Store 状态定义

**文件**: `src/store/modules/license.js`

| 字段 | 类型 | 说明 |
|------|------|------|
| `expiryTimestamp` | `number` | 授权到期时间戳（秒），0 表示未授权 |
| `firstLaunchTime` | `number` | 首次启动时间戳（秒） |
| `licenseCode` | `string` | 已保存的授权码 |
| `requestCode` | `string` | 本机申请码（Base64） |
| `ntpTimeOffset` | `number` | NTP 时间与本地时间偏移（秒） |
| `isAuthorized` | `boolean` | 是否已授权 |

### 核心方法

#### `init()` — 初始化流程

```
1. 从 IndexedDB 读取已保存的授权数据
2. 记录首次启动时间（如果不存在）
3. 获取 NTP 时间偏移（防篡改）
4. 检查授权状态是否有效
5. 生成本机申请码
```

#### `generateRequestCode()` — 生成申请码

```
Tauri 环境:
  1. invoke("get_machine_id") 获取设备硬件 ID
  2. 获取当前 Unix 时间戳
  3. 拼接: "${machineId}|${unixTime}"
  4. Base64 编码 → requestCode

浏览器环境:
  1. 使用 localStorage 存储的随机 browserMachineId
  2. 同样拼接 + Base64 编码
```

#### `verifyLicense(code)` — 验证授权码

```
Tauri 环境:
  1. invoke("get_machine_id") 获取当前硬件 ID
  2. invoke("verify_license", { code, currentMachineId })
  3. 验证通过 → 保存 expiryTimestamp、licenseCode
  4. 更新授权状态并持久化到 IndexedDB

浏览器环境:
  直接返回失败: "请在桌面应用中输入授权码"
```

#### `fetchNtpTime()` — NTP 校时

```
Tauri 环境:
  1. 优先: invoke("get_ntp_time") — 真正 NTP 协议
  2. 备选: 并行请求 HTTP API（QQ/WorldTimeAPI/淘宝）
  3. 取成功结果，按 RTT 排序，取最快 2 个平均偏移

浏览器环境:
  ntpTimeOffset = 0（直接使用本地时间）
```

#### `checkAuthorization()` — 检查授权状态

```javascript
// 使用 NTP 校正后的时间判断是否过期
const now = Math.floor(Date.now() / 1000) + this.ntpTimeOffset;
this.isAuthorized = this.expiryTimestamp > now;
```

---

## Tauri 后端命令

**文件**: `tauri/src-tauri/src/lib.rs`

### `get_machine_id()`

从 Windows 注册表读取设备唯一标识：

```
注册表路径: HKLM\SOFTWARE\Microsoft\SQMClient
键名: MachineId
```

### `verify_license(code, current_machine_id)`

```
1. 从嵌入的 public_key.bin 加载公钥
2. 调用 Rust SDK 验证签名
3. 校验硬件 ID 是否匹配
4. 校验产品名称是否为本产品名称
5. 返回 { expiry_timestamp, product_name, hardware_id }
```

### `get_ntp_time()`

```
NTP 服务器列表:
  - ntp.aliyun.com:123
  - ntp.tencent.com:123
  - ntp.baidu.com:123
  - ntp1.ntsc.ac.cn:123
  - ntp2.ntsc.ac.cn:123

协议: NTPv3 (UDP 48字节请求/响应)
超时: 3秒
时间转换: NTP时间戳 - 2208988800 = Unix时间戳
```

---

## Rust SDK 验证流程

**文件**: `tauri/src-tauri/rustsdk/src/lib.rs`

### 公钥格式

```
BCRYPT_ECCPUBLIC_BLOB (Windows 格式):
[4字节 magic: 0x31534345] [4字节 cbKey=32] [32字节 X] [32字节 Y]
```

### 授权码二进制结构

```
Base64 解码后:
┌──────────────────────────────────────────────────────────┐
│ dataLen (4字节, LE) │ license_data │ signature (64字节)  │
└──────────────────────────────────────────────────────────┘

license_data 结构:
┌────────────────────────────────────────────────────────────────────┐
│ hw_id_len(4) │ hardware_id(N) │ apply_ts(8) │ name_len(4) │ name(M) │ expiry_ts(8) │
└────────────────────────────────────────────────────────────────────┘
```

### 验证步骤

```
1. parse_public_key(blob) → VerifyingKey
   - 验证 magic = 0x31534345
   - 验证 key length = 32
   - 构建 SEC1 未压缩点: 0x04 + X + Y

2. Base64 解码授权码

3. 解析 dataLen + license_data + signature

4. SHA-256(license_data) → hash

5. ECDSA P-256 验证签名 (raw R||S 格式)

6. deserialize_license(license_data) → LicenseInfo
   - 解析 hardware_id, product_name, expiry_timestamp
```

---

## 完整授权流程

```
用户操作                    前端                              后端
─────────────────────────────────────────────────────────────────────
1. 打开授权对话框     →  generateRequestCode()
                       ←  显示申请码                        get_machine_id()
                       
2. 复制申请码发给管理员  复制到剪贴板

3. 管理员生成授权码    →                                   AuthorizationTool 签名
                       ←                                   生成 Base64 授权码

4. 用户粘贴授权码     →  inputCode = "..."
                       
5. 点击验证           →  verifyLicense(code)
                                                  invoke() →  verify_license()
                       ←  { success, expiry }          ←  验证签名 + 硬件ID

6. 验证成功           →  保存到 IndexedDB
                       →  checkAuthorization() = true
                       →  显示到期时间
                       →  水印消失
```

---

## 数据持久化

| 数据 | 存储位置 | 说明 |
|------|----------|------|
| `expiryTimestamp` | IndexedDB `toolLicense` | 授权到期时间 |
| `firstLaunchTime` | IndexedDB `toolLicense` | 首次启动时间 |
| `licenseCode` | IndexedDB `toolLicense` | 已输入的授权码 |
| `browserMachineId` | localStorage | 浏览器环境的随机设备 ID |

---

## 未授权状态表现

- 手机预览区显示 **45° 旋转水印**："内容由AI生成"
- 授权对话框可正常打开，但验证会提示"请在桌面应用中输入授权码"

---

## 安全机制

| 机制 | 说明 |
|------|------|
| ECDSA P-256 签名 | 非对称加密，私钥仅在管理端 |
| 硬件 ID 绑定 | 授权码与设备 MachineId 绑定 |
| NTP 校时 | 防止修改本地时间绕过到期限制 |
| 多源 NTP | Tauri 环境 5 个 NTP 服务器 + 3 个 HTTP API 备选 |

---

## React 迁移方案

### 方案一：函数式组件 + Zustand

**适用场景**：新项目或 React 18+ 项目，追求简洁和类型安全

#### 技术栈

| Vue 3 | React 替代 |
|-------|-----------|
| `<script setup>` | 函数式组件 + Hooks |
| Pinia | Zustand |
| Ant Design Vue | Ant Design (antd) |
| `v-model` | `value` + `onChange` |
| `v-if` | `{condition && < JSX />}` |
| `watch` | `useEffect` |

#### Store 实现 (Zustand)

```typescript
// store/license.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface LicenseState {
  expiryTimestamp: number;
  firstLaunchTime: number;
  licenseCode: string;
  requestCode: string;
  ntpTimeOffset: number;
  isAuthorized: boolean;
  expiryDate: string;
}

interface LicenseActions {
  init: () => Promise<void>;
  generateRequestCode: () => Promise<void>;
  verifyLicense: (code: string) => Promise<{ success: boolean; message?: string }>;
  resetLicense: () => void;
  checkAuthorization: () => void;
  fetchNtpTime: () => Promise<void>;
}

export const useLicenseStore = create<LicenseState & LicenseActions>()(
  persist(
    (set, get) => ({
      // State
      expiryTimestamp: 0,
      firstLaunchTime: 0,
      licenseCode: '',
      requestCode: '',
      ntpTimeOffset: 0,
      isAuthorized: false,

      // Getters (computed)
      get expiryDate() {
        const state = get();
        if (!state.expiryTimestamp) return '';
        return new Date(state.expiryTimestamp * 1000).toLocaleDateString('zh-CN');
      },

      // Actions
      init: async () => {
        const { fetchNtpTime, checkAuthorization, generateRequestCode } = get();
        await fetchNtpTime();
        checkAuthorization();
        await generateRequestCode();
      },

      generateRequestCode: async () => {
        const isTauri = !!window.__TAURI_INTERNALS__;
        if (isTauri) {
          const { invoke } = await import('@tauri-apps/api/core');
          const machineId = await invoke<string>('get_machine_id');
          const unixTime = Math.floor(Date.now() / 1000);
          set({ requestCode: btoa(`${machineId}|${unixTime}`) });
        } else {
          let browserId = localStorage.getItem('browserMachineId');
          if (!browserId) {
            browserId = 'browser-' + Math.random().toString(36).substring(2, 15);
            localStorage.setItem('browserMachineId', browserId);
          }
          const unixTime = Math.floor(Date.now() / 1000);
          set({ requestCode: btoa(`${browserId}|${unixTime}`) });
        }
      },

      verifyLicense: async (code) => {
        const isTauri = !!window.__TAURI_INTERNALS__;
        if (!isTauri) {
          return { success: false, message: '请在桌面应用中输入授权码' };
        }
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const machineId = await invoke<string>('get_machine_id');
          const result = await invoke<{ expiry_timestamp: number; product_name: string }>(
            'verify_license',
            { code, currentMachineId: machineId }
          );
          set({ expiryTimestamp: result.expiry_timestamp, licenseCode: code });
          get().checkAuthorization();
          return { success: true };
        } catch (e) {
          return { success: false, message: String(e) || '授权码有误' };
        }
      },

      resetLicense: () => {
        set({ expiryTimestamp: 0, licenseCode: '' });
        get().checkAuthorization();
      },

      checkAuthorization: () => {
        const { expiryTimestamp, ntpTimeOffset } = get();
        const now = Math.floor(Date.now() / 1000) + ntpTimeOffset;
        set({ isAuthorized: expiryTimestamp > now });
      },

      fetchNtpTime: async () => {
        const isTauri = !!window.__TAURI_INTERNALS__;
        if (!isTauri) {
          set({ ntpTimeOffset: 0 });
          return;
        }
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const result = await invoke<{ unixtime: number; rtt_ms: number }>('get_ntp_time');
          const rtt = result.rtt_ms / 2;
          const localTime = Math.floor((Date.now() + rtt) / 1000);
          set({ ntpTimeOffset: result.unixtime - localTime });
        } catch {
          set({ ntpTimeOffset: 0 });
        }
      },
    }),
    {
      name: 'toolLicense',
      storage: createJSONStorage(() => ({
        getItem: async (name) => {
          const db = await openDB();
          const tx = db.transaction('store', 'readonly');
          const store = tx.objectStore('store');
          const result = await store.get(name);
          return result ? JSON.parse(result) : null;
        },
        setItem: async (name, value) => {
          const db = await openDB();
          const tx = db.transaction('store', 'readwrite');
          const store = tx.objectStore('store');
          await store.put(JSON.stringify(value), name);
        },
        removeItem: async (name) => {
          const db = await openDB();
          const tx = db.transaction('store', 'readwrite');
          const store = tx.objectStore('store');
          await store.delete(name);
        },
      })),
    }
  )
);
```

#### 组件实现

```tsx
// components/LicenseDialog.tsx
import { useState, useEffect } from 'react';
import { Modal, Input, Button, Divider, message } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { useLicenseStore } from '../store/license';

const { TextArea } = Input;

interface LicenseDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function LicenseDialog({ open, onClose }: LicenseDialogProps) {
  const {
    requestCode,
    expiryDate,
    isAuthorized,
    expiryTimestamp,
    generateRequestCode,
    verifyLicense,
    resetLicense,
  } = useLicenseStore();

  const [inputCode, setInputCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState({ text: '', success: false });

  useEffect(() => {
    if (open) {
      generateRequestCode();
    }
  }, [open]);

  const handleVerify = async () => {
    if (!inputCode.trim()) return;
    setVerifying(true);
    setVerifyMsg({ text: '', success: false });
    try {
      const result = await verifyLicense(inputCode.trim());
      if (result.success) {
        setVerifyMsg({ text: `授权成功，到期：${expiryDate}`, success: true });
        setInputCode('');
      } else {
        setVerifyMsg({ text: result.message || '验证失败', success: false });
      }
    } catch {
      setVerifyMsg({ text: '授权码有误', success: false });
    } finally {
      setVerifying(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(requestCode).then(() => {
      message.success('已复制');
    });
  };

  return (
    <Modal
      title="授权验证"
      open={open}
      onCancel={onClose}
      footer={null}
      width={420}
    >
      <div className="license-section">
        <div className="section-label">本机申请码</div>
        <div className="request-code-box">
          <span className="request-code">{requestCode}</span>
          <Button type="link" size="small" icon={<CopyOutlined />} onClick={handleCopy}>
            复制
          </Button>
        </div>
      </div>

      <Divider />

      <div className="license-section">
        <div className="section-label">输入授权码</div>
        <TextArea
          value={inputCode}
          onChange={(e) => setInputCode(e.target.value)}
          placeholder="请输入授权码"
          autoSize={{ minRows: 3, maxRows: 5 }}
        />
        <div className="verify-row">
          <Button type="primary" onClick={handleVerify} loading={verifying}>
            验证
          </Button>
          {verifyMsg.text && (
            <span className={verifyMsg.success ? 'success' : 'error'}>
              {verifyMsg.text}
            </span>
          )}
        </div>
      </div>

      {expiryTimestamp > 0 && (
        <div className={`license-info ${!isAuthorized ? 'expired' : ''}`}>
          <span>授权到期：{expiryDate}</span>
          <Button type="link" danger size="small" onClick={resetLicense}>
            重置
          </Button>
        </div>
      )}
    </Modal>
  );
}
```

#### 方案特点

| 维度 | 说明 |
|------|------|
| **状态管理** | Zustand，API 与 Pinia 几乎一致，迁移成本最低 |
| **TypeScript** | 天然支持，类型推导完整 |
| **持久化** | 使用 `zustand/middleware` 的 persist 插件 |
| **性能** | 细粒度订阅，按需渲染 |
| **依赖** | `zustand` + `antd` |
