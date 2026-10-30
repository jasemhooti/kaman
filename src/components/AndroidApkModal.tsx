import React, { useState } from 'react';

interface AndroidApkModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AndroidApkModal: React.FC<AndroidApkModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'download' | 'github' | 'gradle'>('download');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const manifestSnippet = `<!-- AndroidManifest.xml (بدون هیچ‌گونه دسترسی اینترنت یا سرور) -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.kamanduel.bow3d">
    <!-- ZERO INTERNET PERMISSION: 100% Offline Standalone APK -->
    <uses-feature android:glEsVersion="0x00030000" android:required="true" />
    <application
        android:hardwareAccelerated="true"
        android:label="Kaman Duel 3D"
        android:theme="@android:style/Theme.NoTitleBar.Fullscreen">
        <activity
            android:name=".MainActivity"
            android:screenOrientation="sensorLandscape"
            android:exported="true">
            <!-- Loads directly from file:///android_asset/www/index.html -->
        </activity>
    </application>
</manifest>`;

  const gradleCommands = `# تمام فایل‌های کامپایل‌شده بازی از قبل داخل پوشه زیر قرار گرفته‌اند:
# android/app/src/main/assets/www/
# بدون نیاز به Node.js یا سرور، مستقیماً فایل APK مستقل را بسازید:

cd android
gradle assembleRelease

# مسیر خروجی فایل APK کاملاً آفلاین و مستقل:
# android/app/build/outputs/apk/release/app-release.apk`;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-auto"
      style={{ backgroundColor: 'rgba(8, 11, 16, 0.90)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="apk-modal-title"
    >
      <div className="w-full max-w-2xl rounded-xl border border-amber-500/30 bg-[#121824] p-6 text-[#f4efe6] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <svg className="w-8 h-8 text-amber-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <div>
              <h2 id="apk-modal-title" className="text-lg font-extrabold text-amber-400">
                دانلود پکیج APK کاملاً مستقل و آفلاین (بدون سرور و بدون اینترنت)
              </h2>
              <p className="text-xs text-slate-300 mt-0.5">
                موتور سه‌بعدی، فیزیک، صداها و گرافیک بازی ۱۰۰٪ داخل حافظه داخلی APK (`assets/www`) بسته‌بندی شده‌اند و حتی مجوز اینترنت (`INTERNET`) هم در مانیفست اندروید وجود ندارد.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن پنجره خروجی اندروید"
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 transition-colors shrink-0"
          >
            بستن [Esc]
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-[#0c1017] p-1 border border-white/10">
          <button
            type="button"
            onClick={() => setActiveTab('download')}
            className={`flex-1 rounded-md py-2 px-3 text-xs font-bold transition-colors whitespace-nowrap ${
              activeTab === 'download'
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            ۱. دانلود مستقیم پکیج آماده اندروید
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('github')}
            className={`flex-1 rounded-md py-2 px-3 text-xs font-bold transition-colors whitespace-nowrap ${
              activeTab === 'github'
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            ۲. کامپایل خودکار فایل .apk بدون نصب برنامه
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('gradle')}
            className={`flex-1 rounded-md py-2 px-3 text-xs font-bold transition-colors whitespace-nowrap ${
              activeTab === 'gradle'
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            ۳. کامپایل با Android Studio / Gradle
          </button>
        </div>

        <div className="mt-4 space-y-4 text-sm leading-relaxed">
          {activeTab === 'download' && (
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-emerald-400 text-sm">
                      پروژه کامل Native Android + باندل آفلاین از پیش کامپایل‌شده (`assets/www`)
                    </h3>
                    <p className="text-xs text-slate-300 mt-1">
                      چون محیط مرورگر اجازه اجرای مستقیم کامپایلر ۶ گیگابایتی Android SDK را نمی‌دهد، ما کل پروژه Native اندروید (`MainActivity.java` + `AndroidManifest.xml` بدون اینترنت + فایل‌های کامپایل‌شده بازی داخل `android/app/src/main/assets/www/`) را آماده کرده‌ایم تا با یک کلیک دانلود کنید:
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <a
                    href="./KamanDuel3D-Android-Offline-Project.tar.gz"
                    download="KamanDuel3D-Android-Offline-Project.tar.gz"
                    className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-extrabold text-slate-950 hover:bg-amber-400 transition-colors shadow-lg"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    دانلود پکیج کامل اندروید آفلاین (KamanDuel3D-Android-Offline-Project.tar.gz)
                  </a>
                </div>
              </div>

              <div className="rounded-lg bg-[#090d14] border border-white/10 p-3 font-mono-num text-xs text-slate-200 overflow-x-auto max-h-40" dir="ltr">
                <pre className="text-[11px] leading-5">{manifestSnippet}</pre>
              </div>
            </div>
          )}

          {activeTab === 'github' && (
            <div className="space-y-3 text-xs text-slate-200">
              <div className="rounded-xl border border-amber-500/30 bg-amber-950/15 p-4 space-y-2.5">
                <h3 className="font-bold text-amber-400 text-sm">
                  دریافت فایل `app-release.apk` بدون نیاز به نصب Android Studio (کاملاً رایگان با GitHub Actions):
                </h3>
                <p className="text-slate-300">
                  درون این پروژه فایل <span className="font-mono-num text-amber-300">.github/workflows/build-apk.yml</span> قرار داده شده است. کافی است:
                </p>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-200">
                  <li>
                    پروژه را از منوی بالای AI Studio به <strong>GitHub</strong> بفرستید (یا پکیج دانلودشده در تب اول را در یک مخزن GitHub آپلود کنید).
                  </li>
                  <li>
                    به محض آپلود، سرورهای GitHub به صورت خودکار کامپایلر JDK 17 و Android SDK را اجرا کرده و تمام فایل‌های بازی را داخل <span className="font-mono-num text-emerald-400">assets/www/</span> بسته‌بندی می‌کنند.
                  </li>
                  <li>
                    از تب <strong>Actions</strong> در گیت‌هاب خود، فایل آماده <span className="font-mono-num text-emerald-400">KamanDuel3D-Standalone-Offline-APK</span> را دانلود و روی گوشی نصب کنید (۱۰۰٪ آفلاین، بدون سرور و بدون اینترنت).
                  </li>
                </ol>
              </div>
            </div>
          )}

          {activeTab === 'gradle' && (
            <div className="space-y-3 text-xs text-slate-200">
              <p className="text-slate-300">
                اگر روی سیستم خود <strong>Android Studio</strong> یا <strong>Gradle</strong> دارید، پکیج تب اول را استخراج کرده و پوشه <span className="font-mono-num text-amber-300">android/</span> را باز کنید:
              </p>
              <div className="rounded-lg bg-[#090d14] border border-white/10 p-3 font-mono-num text-xs text-slate-200 overflow-x-auto" dir="ltr">
                <pre className="text-[11px] leading-5">{gradleCommands}</pre>
              </div>
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => handleCopy(gradleCommands)}
                  className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10 transition-colors"
                >
                  {copied ? 'کپی شد!' : 'کپی دستورات Gradle'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
