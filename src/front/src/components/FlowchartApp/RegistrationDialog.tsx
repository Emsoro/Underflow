import React, { useState, useEffect } from 'react';
import { getApplyCode, verifyLicenseCode, saveLicense, resetLicense, getLicenseStatus, isTauri, getNtpTime } from '../../lib/tauri';
import type { LicenseInfo, LicenseStatus } from '../../lib/tauri';

const i18n = {
  en: {
    title: 'License Registration',
    applyCode: 'Request Code',
    generate: 'Generate',
    copy: 'Copy',
    applyCodeHint: 'Send the request code to the developer to get a license code',
    generatePlaceholder: 'Click Generate to create request code',
    licenseCode: 'License Code',
    licenseCodePlaceholder: 'Enter license code',
    verifyActivate: 'Verify & Activate',
    verifying: 'Verifying...',
    registered: 'Registered',
    product: 'Product',
    validUntil: 'Valid until',
    daysRemaining: 'days remaining',
    resetLicense: 'Reset License',
    resetting: 'Resetting...',
    confirmReset: 'Are you sure you want to reset the license?',
    generated: 'Request code generated, copy and send to developer',
    generateFailed: 'Failed to generate request code',
    enterLicense: 'Please enter a license code',
    licenseExpired: 'License code has expired',
    verifySuccess: 'Registration successful! Valid until {date}, {days} days remaining',
    verifyFailed: 'Verification failed',
    resetSuccess: 'License has been reset',
    resetFailed: 'Reset failed',
    copied: 'Copied to clipboard',
  },
  zh: {
    title: '软件注册',
    applyCode: '申请码',
    generate: '生成',
    copy: '复制',
    applyCodeHint: '将申请码发送给开发者获取注册码',
    generatePlaceholder: '点击生成申请码',
    licenseCode: '注册码',
    licenseCodePlaceholder: '请输入注册码',
    verifyActivate: '验证并激活',
    verifying: '验证中...',
    registered: '已注册',
    product: '产品',
    validUntil: '有效期至',
    daysRemaining: '天',
    resetLicense: '重置注册信息',
    resetting: '重置中...',
    confirmReset: '确定要重置注册信息吗？',
    generated: '申请码已生成，请复制发送给开发者获取注册码',
    generateFailed: '生成申请码失败',
    enterLicense: '请输入注册码',
    licenseExpired: '注册码已过期',
    verifySuccess: '注册成功！有效期至 {date}，剩余 {days} 天',
    verifyFailed: '验证失败',
    resetSuccess: '注册信息已重置',
    resetFailed: '重置失败',
    copied: '已复制到剪贴板',
  },
} as const;

type LangKey = keyof typeof i18n.en;

interface RegistrationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onStatusChange: (status: LicenseStatus) => void;
  language: 'en' | 'zh';
}

const RegistrationDialog: React.FC<RegistrationDialogProps> = ({ isOpen, onClose, onStatusChange, language }) => {
  const t = (key: LangKey): string => i18n[language][key];

  const [applyCode, setApplyCode] = useState('');
  const [licenseCode, setLicenseCode] = useState('');
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const setMsg = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    setMessage(msg);
    setMessageType(type);
  };

  useEffect(() => {
    if (isOpen) {
      loadStatus();
    }
  }, [isOpen]);

  const loadStatus = async () => {
    try {
      const result = await getLicenseStatus();
      setStatus(result);
      setMsg('');
    } catch (err) {
      console.error('Failed to load license status:', err);
      setStatus({
        is_registered: false,
        expiry_timestamp: null,
        days_remaining: null,
        product_name: null,
        machine_id: '',
      });
    }
  };

  const handleGenerateApplyCode = async () => {
    try {
      const code = await getApplyCode();
      setApplyCode(code);
      setMsg(t('generated'), 'info');
    } catch (err) {
      setMsg(`${t('generateFailed')}: ${err}`, 'error');
    }
  };

  const handleVerify = async () => {
    if (!licenseCode.trim()) {
      setMsg(t('enterLicense'), 'error');
      return;
    }

    setIsVerifying(true);
    setMsg('');

    try {
      let info: LicenseInfo;
      let currentTime: number;

      if (isTauri()) {
        try {
          currentTime = await getNtpTime();
        } catch {
          currentTime = Math.floor(Date.now() / 1000);
        }
      } else {
        currentTime = Math.floor(Date.now() / 1000);
      }

      info = await verifyLicenseCode(licenseCode.trim());

      if (info.expiry_timestamp < currentTime) {
        setMsg(t('licenseExpired'), 'error');
        setIsVerifying(false);
        return;
      }

      await saveLicense(licenseCode.trim());

      const expiryDate = new Date(info.expiry_timestamp * 1000);
      const daysRemaining = Math.ceil((info.expiry_timestamp - currentTime) / 86400);

      setMsg(t('verifySuccess').replace('{date}', formatDate(expiryDate)).replace('{days}', String(daysRemaining)), 'success');

      const newStatus: LicenseStatus = {
        is_registered: true,
        expiry_timestamp: info.expiry_timestamp,
        days_remaining: daysRemaining,
        product_name: info.product_name,
        machine_id: info.hardware_id,
      };

      setStatus(newStatus);
      onStatusChange(newStatus);
    } catch (err) {
      setMsg(`${t('verifyFailed')}: ${err}`, 'error');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm(t('confirmReset'))) {
      return;
    }

    setIsResetting(true);
    try {
      await resetLicense();
      setStatus({
        is_registered: false,
        expiry_timestamp: null,
        days_remaining: null,
        product_name: null,
        machine_id: '',
      });
      setLicenseCode('');
      setMsg(t('resetSuccess'), 'info');
      onStatusChange({
        is_registered: false,
        expiry_timestamp: null,
        days_remaining: null,
        product_name: null,
        machine_id: '',
      });
    } catch (err) {
      setMsg(`${t('resetFailed')}: ${err}`, 'error');
    } finally {
      setIsResetting(false);
    }
  };

  const handleCopyApplyCode = async () => {
    if (applyCode) {
      try {
        await navigator.clipboard.writeText(applyCode);
        setMsg(t('copied'), 'success');
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = applyCode;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        setMsg(t('copied'), 'success');
      }
    }
  };

  const formatDate = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${mi}`;
  };

  if (!isOpen) return null;

  const msgBg = messageType === 'success' ? '#dcfce7' : messageType === 'error' ? '#fee2e2' : '#f1f5f9';
  const msgColor = messageType === 'success' ? '#16a34a' : messageType === 'error' ? '#dc2626' : '#64748b';

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 10000,
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: 24, width: 420,
        boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
      }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#1e293b' }}>{t('title')}</h2>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 4,
            fontSize: 20, lineHeight: 1, color: '#94a3b8',
          }}>×</button>
        </div>

        {/* Message */}
        {message && (
          <div style={{
            padding: '10px 14px', borderRadius: 6, marginBottom: 16,
            backgroundColor: msgBg, color: msgColor, fontSize: 13,
          }}>
            {message}
          </div>
        )}

        {status?.is_registered ? (
          /* Registered state */
          <div style={{ marginBottom: 16 }}>
            <div style={{ padding: 16, background: '#f0fdf4', borderRadius: 8, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} />
                <span style={{ fontWeight: 600, color: '#166534' }}>{t('registered')}</span>
              </div>
              {status.product_name && (
                <div style={{ fontSize: 13, color: '#15803d', marginBottom: 4 }}>
                  {t('product')}: {status.product_name}
                </div>
              )}
              {status.expiry_timestamp && (
                <div style={{ fontSize: 13, color: '#15803d' }}>
                  {t('validUntil')}: {formatDate(new Date(status.expiry_timestamp * 1000))}
                </div>
              )}
              {status.days_remaining != null && (
                <div style={{ fontSize: 12, color: '#059669', marginTop: 4 }}>
                  {status.days_remaining} {t('daysRemaining')}
                </div>
              )}
            </div>
            <button
              onClick={handleReset}
              disabled={isResetting}
              style={{
                width: '100%', padding: 10, borderRadius: 8,
                border: '1px solid #e2e8f0', background: '#fff',
                color: '#64748b', cursor: isResetting ? 'not-allowed' : 'pointer', fontSize: 14,
                opacity: isResetting ? 0.5 : 1,
              }}
            >
              {isResetting ? t('resetting') : t('resetLicense')}
            </button>
          </div>
        ) : (
          /* Unregistered state */
          <>
            {/* Apply code */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#475569', marginBottom: 6 }}>
                {t('applyCode')}
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={applyCode}
                  readOnly
                  style={{
                    flex: 1, padding: '8px 12px', borderRadius: 8,
                    border: '1px solid #e2e8f0', fontSize: 13,
                    background: '#f8fafc', color: '#64748b',
                    outline: 'none',
                  }}
                  placeholder={t('generatePlaceholder')}
                />
                <button onClick={handleGenerateApplyCode} style={{
                  padding: '8px 16px', borderRadius: 8,
                  border: 'none', background: '#3b82f6',
                  color: '#fff', cursor: 'pointer', fontSize: 13,
                  fontWeight: 500,
                }}>
                  {t('generate')}
                </button>
                {applyCode && (
                  <button onClick={handleCopyApplyCode} style={{
                    padding: '8px 12px', borderRadius: 8,
                    border: '1px solid #e2e8f0', background: '#fff',
                    color: '#64748b', cursor: 'pointer', fontSize: 13,
                  }}>
                    {t('copy')}
                  </button>
                )}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                {t('applyCodeHint')}
              </div>
            </div>

            {/* License code */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#475569', marginBottom: 6 }}>
                {t('licenseCode')}
              </label>
              <textarea
                value={licenseCode}
                onChange={(e) => setLicenseCode(e.target.value)}
                placeholder={t('licenseCodePlaceholder')}
                rows={3}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8,
                  border: '1px solid #e2e8f0', fontSize: 13,
                  resize: 'vertical', boxSizing: 'border-box',
                  fontFamily: 'monospace', outline: 'none',
                }}
              />
            </div>

            {/* Verify button */}
            <button
              onClick={handleVerify}
              disabled={isVerifying}
              style={{
                width: '100%', padding: 12, borderRadius: 8,
                border: 'none', background: '#3b82f6',
                color: '#fff', cursor: isVerifying ? 'not-allowed' : 'pointer', fontSize: 14,
                fontWeight: 500, opacity: isVerifying ? 0.5 : 1,
              }}
            >
              {isVerifying ? t('verifying') : t('verifyActivate')}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default RegistrationDialog;
