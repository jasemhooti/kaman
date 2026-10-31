import React, { useState } from 'react';

interface AndroidApkModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AndroidApkModal: React.FC<AndroidApkModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'download' | 'bazaar' | 'gradle'>('download');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const manifestSnippet = `<!-- AndroidManifest.xml (پکیج ir.jasem.ply - جنگ تانک ها - آماده کافه‌بازار و مایکت) -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <!-- ZERO INTERNET PERMISSION: 100% Offline Standalone APK -->
    <uses-feature android:glEsVersion="0x00030000" android:required="true" />
    <application
        android:hardwareAccelerated="true"
        android:label="جنگ تانک ها"
        android:theme="@android:style/Theme.NoTitleBar.Fullscreen">
        <activity
            android:name=".MainActivity"
            android:screenOrientation="fullSensor"
            android:configChanges="orientation|screenSize|keyboardHidden"
            android:exported="true">
            <!-- Loads directly from file:///android_asset/www/index.html -->
        </activity>
    </application>
</manifest>`;

  const gradleCommands = `# پروژه اندروید با نام پکیج ir.jasem.ply و کلید امضای واقعی (release-key.jks) تنظیم شده است:
cd android
gradle assembleRelease

# مسیر خروجی فایل APK امضاشده (Release Signed) آماده آپلود در کافه‌بازار و مایکت:
# android/app/build/outputs/apk/release/جنگ-تانک-ها-ir.jasem.ply-release.apk`;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 pointer-events-auto"
      style={{ backgroundColor: 'rgba(8, 11, 16, 0.92)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="apk-modal-title"
    >
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-amber-500/40 bg-[#121824] p-4 sm:p-6 text-[#f4efe6] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 pb-3.5 gap-2">
          <div>
            <h2 id="apk-modal-title" className="text-base sm:text-lg font-extrabold text-amber-400">
              خروجی APK امضاشده «جنگ تانک ها» (`ir.jasem.ply`) · کافه‌بازار و مایکت
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              امضاشده با کلید واقعی (`release-key.jks`)، ۱۰۰٪ آفلاین و بدون نیاز به سرور، با چرخش خودکار عمودی و افقی (`fullSensor`).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 shrink-0"
          >
            بستن
          </button>
        </div>

        <div className="mt-3.5 flex items-center gap-1.5 rounded-xl bg-[#0c1017] p-1 border border-white/10">
          <button
            type="button"
            onClick={() => setActiveTab('download')}
            className={`flex-1 rounded-lg py-2 px-2 text-xs font-bold transition-colors whitespace-nowrap ${
              activeTab === 'download'
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            ۱. دانلود پکیج امضاشده اندروید
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('bazaar')}
            className={`flex-1 rounded-lg py-2 px-2 text-xs font-bold transition-colors whitespace-nowrap ${
              activeTab === 'bazaar'
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            ۲. مشخصات کافه‌بازار و مایکت
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('gradle')}
            className={`flex-1 rounded-lg py-2 px-2 text-xs font-bold transition-colors whitespace-nowrap ${
              activeTab === 'gradle'
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            ۳. ساخت خودکار GitHub / Gradle
          </button>
        </div>

        <div className="mt-4 space-y-3.5 text-xs sm:text-sm leading-relaxed">
          {activeTab === 'download' && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 space-y-3">
              <div className="font-bold text-emerald-300">
                پکیج کامل پروژه اندروید «جنگ تانک ها» (`ir.jasem.ply`) با امضای Release
              </div>
              <p className="text-slate-300 text-xs">
                تمام مدل‌های سه‌بعدی ۱۰ تانک، فروشگاه گلوله، صداها، کلید امضای دیجیتال واقعی (`android/app/release-key.jks`) و فایل اجرای آفلاین داخل پوشه `android/app/src/main/assets/www/index.html` قرار داده شده‌اند.
              </p>
              <div className="pt-1 flex flex-wrap items-center gap-3">
                <a
                  href="./TankWars3D-ir.jasem.ply-Android-Signed.tar.gz"
                  download="TankWars3D-ir.jasem.ply-Android-Signed.tar.gz"
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-xs sm:text-sm font-extrabold text-slate-950 shadow-lg hover:bg-amber-400 transition-colors"
                >
                  دانلود پکیج کامل اندروید (TankWars3D-ir.jasem.ply.tar.gz)
                </a>
              </div>
            </div>
          )}

          {activeTab === 'bazaar' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-[#0c1017] p-3 border border-white/10">
                  <span className="text-slate-400 block">نام برنامه (Label):</span>
                  <strong className="text-amber-400 text-sm">جنگ تانک ها</strong>
                </div>
                <div className="rounded-lg bg-[#0c1017] p-3 border border-white/10">
                  <span className="text-slate-400 block">نام پکیج (Package Name):</span>
                  <strong className="text-emerald-400 text-sm font-mono-num">ir.jasem.ply</strong>
                </div>
                <div className="rounded-lg bg-[#0c1017] p-3 border border-white/10">
                  <span className="text-slate-400 block">کلید امضای دیجیتال (Keystore):</span>
                  <strong className="text-sky-400 text-xs font-mono-num">release-key.jks (Alias: jasem_key)</strong>
                </div>
                <div className="rounded-lg bg-[#0c1017] p-3 border border-white/10">
                  <span className="text-slate-400 block">نسخه و SDK هدف:</span>
                  <strong className="text-white text-xs font-mono-num">v1.0.0 (Code 1) · Target SDK 34</strong>
                </div>
              </div>
              <pre
                dir="ltr"
                className="overflow-x-auto rounded-lg bg-[#080b10] p-3 text-[11px] font-mono-num text-amber-300 border border-white/10"
              >
                {manifestSnippet}
              </pre>
            </div>
          )}

          {activeTab === 'gradle' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-300">
                فایل `.github/workflows/build-apk.yml` به‌گونه‌ای تنظیم شده که در GitHub Actions مستقیماً فایل **`جنگ-تانک-ها-ir.jasem.ply-release.apk`** را با امضای واقعی می‌سازد:
              </p>
              <div className="relative">
                <pre
                  dir="ltr"
                  className="overflow-x-auto rounded-lg bg-[#080b10] p-3 text-xs font-mono-num text-emerald-300 border border-white/10"
                >
                  {gradleCommands}
                </pre>
                <button
                  type="button"
                  onClick={() => handleCopy(gradleCommands)}
                  className="absolute top-2 right-2 rounded bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/20"
                >
                  {copied ? 'کپی شد!' : 'کپی دستورات'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
