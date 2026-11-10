import type { Article, Flow } from "./types";

/** Administration, part B: system rules and security, email and notifications, site settings. */
export const ADMIN_B_ARTICLES: Article[] = [
  // ---- System rules and security ----
  {
    id: "reg-modes", kind: "feature", area: "system", audience: [], perm: "manage_settings", path: "/admin/general/settings/system",
    title: { en: "Registration mode", ar: "وضع التسجيل" },
    summary: {
      en: "Who can create an account. Email confirmation is always required first. Closed: nobody can register, the Create account option is removed everywhere, and branch and organization admins create the accounts. Open, administrator approves: customers register and confirm their email, then an administrator assigns the organization and approves. Open, customer picks, admin approves: customers pick their organization and branch, and the admins of that branch or organization approve and are emailed. Open, customer picks, no approval: customers pick their organization and branch, confirm their email and can sign in at once. Changing the mode does not affect accounts already waiting for approval.",
      ar: "من يستطيع إنشاء حساب. تأكيد البريد مطلوب دائمًا أولًا. مغلق: لا أحد يستطيع التسجيل وتُزال خيار «إنشاء حساب» من كل مكان، ويُنشئ مديرو الفروع والمؤسسات الحسابات. مفتوح والمدير يوافق: يسجل العملاء ويؤكدون بريدهم ثم يحدد المدير المؤسسة ويوافق. مفتوح والعميل يختار والمدير يوافق: يختار العميل مؤسسته وفرعه ويوافق مديرو ذلك الفرع أو المؤسسة ويصلهم بريد. مفتوح والعميل يختار دون موافقة: يختار العميل مؤسسته وفرعه ويؤكد بريده ويمكنه الدخول فورًا. تغيير الوضع لا يؤثر في الحسابات المنتظرة للموافقة.",
    },
    tips: [{ en: "With no approval, turn on the sign-up captcha: it is then the only filter against bots.", ar: "مع عدم وجود موافقة فعّل كابتشا التسجيل فهي حينها الحاجز الوحيد ضد الروبوتات." }],
  },
  {
    id: "reg-set", kind: "howto", area: "system", audience: [], perm: "manage_settings", path: "/admin/general/settings/system",
    title: { en: "Choose the registration mode", ar: "اختيار وضع التسجيل" },
    summary: { en: "Open or close sign-up, and decide who approves.", ar: "افتح التسجيل أو أغلقه وحدد من يوافق." },
    steps: [
      { en: "Open **Settings**, then the **System rules** tab.", ar: "افتح **الإعدادات** ثم تبويب **قواعد النظام**." },
      { en: "Under **Registration**, choose one of the four modes.", ar: "ضمن **التسجيل** اختر أحد الأوضاع الأربعة." },
      { en: "Save the settings.", ar: "احفظ الإعدادات." },
      { en: "If you chose an approval mode, give the right people the **Approve or reject new customer accounts** permission under Permissions. They then see **Account approvals** in their menu.", ar: "إذا اخترت وضعًا بموافقة فامنح الأشخاص المناسبين صلاحية **الموافقة على الحسابات الجديدة أو رفضها** ضمن الصلاحيات. ستظهر لهم **موافقات الحسابات** في القائمة." },
    ],
    related: ["captcha-set"],
  },
  {
    id: "timers", kind: "howto", area: "system", audience: [], perm: "manage_settings", path: "/admin/general/settings/system",
    title: { en: "Reminders and automatic closing", ar: "التذكيرات والإغلاق التلقائي" },
    summary: { en: "Nudge customers who do not answer, then close the ticket.", ar: "ذكّر العملاء الذين لا يردون ثم أغلق التذكرة." },
    steps: [
      { en: "Open **Settings**, **System rules**, **Reminders and automatic closing**.", ar: "افتح **الإعدادات** ثم **قواعد النظام** ثم **التذكيرات والإغلاق التلقائي**." },
      { en: "Set the **First reminder**, **Second reminder** and **Final warning** in days after the ticket starts waiting for the customer.", ar: "حدد **التذكير الأول** و**التذكير الثاني** و**التحذير الأخير** بالأيام بعد بدء انتظار العميل." },
      { en: "Set **Close with \"No customer response\" after** (days).", ar: "حدد **الإغلاق بسبب «عدم رد العميل» بعد** (بالأيام)." },
      { en: "Set the **Reminder after a ticket is resolved** and **Auto-close after resolved** (days).", ar: "حدد **التذكير بعد حل التذكرة** و**الإغلاق التلقائي بعد الحل** (بالأيام)." },
      { en: "Save. Changes apply from the next minute.", ar: "احفظ. تسري التغييرات من الدقيقة التالية." },
    ],
    tips: [{ en: "Use 0 to turn a step off. Reminders must come in order and before the automatic close. Days are calendar days. The wording of each reminder is under Email templates.", ar: "استخدم 0 لإيقاف خطوة. يجب أن تأتي التذكيرات بالترتيب وقبل الإغلاق التلقائي. الأيام أيام تقويمية. وصياغة كل تذكير ضمن قوالب البريد." }],
  },
  {
    id: "sys-misc", kind: "feature", area: "system", audience: [], perm: "manage_settings", path: "/admin/general/settings/system",
    title: { en: "Other system rules", ar: "قواعد نظام أخرى" },
    summary: {
      en: "Reopen window (days): how long after a ticket is closed the customer can still reopen it. Auto-close after resolved (days): a resolved ticket closes by itself after this many days without a customer reply. Minimum reply length: the number of characters a reply needs to count as a first response. Send notification emails: turn on only after the email provider is configured, until then emails stay queued. Automatic page refresh (seconds): ticket lists and pages re-read their data every this many seconds, 0 turns it off, otherwise 10 to 3600.",
      ar: "مدة إعادة الفتح (بالأيام): المدة التي يستطيع العميل خلالها إعادة فتح التذكرة بعد إغلاقها. الإغلاق التلقائي بعد الحل (بالأيام): تُغلق التذكرة المحلولة تلقائيًا بعد هذه المدة دون رد من العميل. أقل طول للرد: عدد الأحرف اللازم ليُحتسب الرد أول استجابة. إرسال رسائل الإشعارات: فعّله بعد ضبط مزود البريد، وإلى حينها تبقى الرسائل في الانتظار. التحديث التلقائي للصفحة (بالثواني): تعيد قوائم التذاكر وصفحاتها قراءة بياناتها كل هذه المدة، و0 تعطّله وإلا فمن 10 إلى 3600.",
    },
    tips: [{ en: "Business hours, holidays and SLA targets are on the SLA settings page.", ar: "ساعات العمل والعطلات وأهداف اتفاقية الخدمة في صفحة إعدادات اتفاقية الخدمة." }],
  },
  {
    id: "captcha-set", kind: "howto", area: "system", audience: [], perm: "manage_settings", path: "/admin/general/settings/system",
    title: { en: "Turn on the sign-up captcha", ar: "تفعيل كابتشا التسجيل" },
    summary: { en: "A Cloudflare Turnstile check stops bots from creating accounts.", ar: "يمنع اختبار Cloudflare Turnstile الروبوتات من إنشاء الحسابات." },
    steps: [
      { en: "In the Cloudflare dashboard create a free Turnstile widget and copy its **Site key** and **Secret key**.", ar: "في لوحة Cloudflare أنشئ أداة Turnstile مجانية وانسخ **مفتاح الموقع** و**المفتاح السري**." },
      { en: "Open **Settings**, **System rules**, **Sign-up captcha**.", ar: "افتح **الإعدادات** ثم **قواعد النظام** ثم **كابتشا التسجيل**." },
      { en: "Paste both keys and tick **Require the captcha on the sign-up form**.", ar: "الصق المفتاحين وحدد **اشتراط الكابتشا في نموذج التسجيل**." },
      { en: "Save.", ar: "احفظ." },
    ],
    tips: [{ en: "The site key is shown on the sign-up page. The secret key stays on the server and is never shown again. The captcha also protects the forgot-password and email-code forms.", ar: "يظهر مفتاح الموقع في صفحة التسجيل أما المفتاح السري فيبقى على الخادم ولا يُعرض مجددًا. وتحمي الكابتشا أيضًا نماذج نسيت كلمة المرور ورمز البريد." }],
  },
  {
    id: "pw-policy", kind: "howto", area: "system", audience: [], perm: "manage_settings", path: "/admin/general/settings/system",
    title: { en: "Set the password policy", ar: "ضبط سياسة كلمات المرور" },
    summary: { en: "Rules for every new password and optional expiry.", ar: "قواعد لكل كلمة مرور جديدة وانتهاء صلاحية اختياري." },
    steps: [
      { en: "Open **Settings**, **System rules**, **Password policy**.", ar: "افتح **الإعدادات** ثم **قواعد النظام** ثم **سياسة كلمات المرور**." },
      { en: "Set the **Minimum length** (8 to 72) and tick the complexity rules: uppercase, lowercase, number, special character.", ar: "حدد **أقل طول** (من 8 إلى 72) وفعّل قواعد التعقيد: حرف كبير وحرف صغير ورقم ورمز خاص." },
      { en: "To make passwords expire, tick **Passwords expire** and set the **Password lifetime** in days.", ar: "لجعل كلمات المرور تنتهي حدد **تنتهي كلمات المرور** وأدخل **عمر كلمة المرور** بالأيام." },
      { en: "Set up to three warning emails in days before expiry (for example 7, 4 and 1). Use 0 to skip one.", ar: "حدد حتى ثلاث رسائل تحذير بالأيام قبل الانتهاء (مثل 7 و4 و1). واستخدم 0 لتخطي إحداها." },
      { en: "Save.", ar: "احفظ." },
    ],
    tips: [{ en: "Existing passwords keep working until changed. When a password expires, the person gets a one-time code by email at the next sign-in and then chooses a new password. The warning wording is under Email templates.", ar: "تستمر كلمات المرور الحالية حتى تُغيَّر. وعند انتهاء كلمة المرور يصل الشخص رمز بالبريد عند الدخول التالي ثم يختار كلمة جديدة. وصياغة التحذير ضمن قوالب البريد." }],
  },
  {
    id: "uploads", kind: "howto", area: "system", audience: [], perm: "manage_settings", path: "/admin/general/settings/uploads",
    title: { en: "Choose which files people can attach", ar: "تحديد الملفات التي يمكن إرفاقها" },
    summary: { en: "File types, size and number for tickets and replies.", ar: "أنواع الملفات وحجمها وعددها للتذاكر والردود." },
    steps: [
      { en: "Open **Settings** and the **File uploads** tab.", ar: "افتح **الإعدادات** وتبويب **رفع الملفات**." },
      { en: "Set the **Largest file size (MB)** and **Files per upload**.", ar: "حدد **أكبر حجم للملف (ميجابايت)** و**عدد الملفات في الرفع الواحد**." },
      { en: "Tick the **Allowed file types** by group: Images, Documents, Spreadsheets, Presentations, Archives.", ar: "حدد **أنواع الملفات المسموحة** حسب المجموعة: صور ومستندات وجداول وعروض تقديمية وأرشيفات." },
      { en: "Save. Changes apply to new uploads straight away.", ar: "احفظ. تسري التغييرات على الرفع الجديد فورًا." },
    ],
    tips: [{ en: "Files already attached stay as they are. Programs and scripts (.exe, .bat, .js) can never be allowed.", ar: "تبقى الملفات المرفقة سابقًا كما هي. ولا يمكن السماح بالبرامج والسكربتات (.exe و.bat و.js) أبدًا." }],
  },
  {
    id: "signin-codes", kind: "howto", area: "system", audience: [], perm: "manage_settings", path: "/admin/general/settings/signin-codes",
    title: { en: "Allow sign-in with a one-time code", ar: "السماح بالدخول برمز لمرة واحدة" },
    summary: { en: "An email code as an option next to the password.", ar: "رمز بالبريد كخيار بجانب كلمة المرور." },
    steps: [
      { en: "Open **Settings** and the **Sign-in codes** tab.", ar: "افتح **الإعدادات** وتبويب **رموز الدخول**." },
      { en: "Switch on **Allow sign in with a one-time code**. It is off until you turn it on, and passwords keep working either way.", ar: "فعّل **السماح بالدخول برمز لمرة واحدة**. وهو معطّل حتى تفعّله، وتبقى كلمات المرور تعمل في الحالتين." },
      { en: "Choose **Who can use it**: customers only, or customers and staff. Staff can use it only if they have two-step verification.", ar: "اختر **من يستطيع استخدامه**: العملاء فقط أو العملاء والموظفون. ولا يستخدمه الموظفون إلا إذا فعّلوا التحقق بخطوتين." },
      { en: "Set the **Code rules**: length (4 to 10 digits), valid for (1 to 60 minutes), wrong attempts allowed, wait before a new code, and codes per email per day.", ar: "حدد **قواعد الرمز**: الطول (من 4 إلى 10 أرقام) ومدة الصلاحية (من 1 إلى 60 دقيقة) وعدد المحاولات الخاطئة والانتظار قبل رمز جديد وعدد الرموز لكل بريد يوميًا." },
      { en: "Save. To change the email wording, select **Open Email templates**.", ar: "احفظ. ولتغيير صياغة الرسالة اختر **فتح قوالب البريد**." },
    ],
    tips: [{ en: "Always on for safety: each code works once and only the latest works, pending or suspended accounts cannot use codes, the reply is the same whether the email has an account or not, and every code sign-in is in the audit log.", ar: "مفعّلة دائمًا للأمان: كل رمز يعمل مرة واحدة والأحدث فقط صالح، والحسابات المعلقة أو الموقوفة لا تستخدم الرموز، والرد واحد سواء كان للبريد حساب أم لا، وكل دخول بالرمز يُسجَّل في سجل التدقيق." }],
  },
  {
    id: "handover", kind: "howto", area: "system", audience: [], path: "/admin/general/settings/handover",
    title: { en: "Hand over the system to a new owner", ar: "تسليم النظام إلى مالك جديد" },
    summary: { en: "Transfer the administrator role and clear the sample data.", ar: "انقل دور المدير وامسح البيانات التجريبية." },
    steps: [
      { en: "Add the new administrator as a staff member first (**Staff**).", ar: "أضف المدير الجديد كموظف أولًا (**الموظفون**)." },
      { en: "Open **Settings** and the **Handover** tab. Under **Transfer administrator** choose the **New administrator** and **Your account type after the transfer** (for example Agent).", ar: "افتح **الإعدادات** وتبويب **التسليم**. ضمن **نقل المدير** اختر **المدير الجديد** و**نوع حسابك بعد النقل** (مثل موظف)." },
      { en: "Select **Transfer administrator**. You leave the page when it is done.", ar: "اختر **نقل المدير**. ستغادر الصفحة عند الانتهاء." },
      { en: "To start clean, use **Remove demo data** and select **Delete demo data**. It removes sample people, organizations, articles and tickets, keeps your own account and real data, and is refused while real tickets exist.", ar: "للبدء من الصفر استخدم **حذف البيانات التجريبية** واختر **حذف البيانات التجريبية**. تُحذف العينات من أشخاص ومؤسسات ومقالات وتذاكر وتبقى بياناتك الحقيقية وحسابك، ويُرفض الحذف إذا وُجدت تذاكر حقيقية." },
    ],
  },

  // ---- Email and notifications ----
  {
    id: "notif-events", kind: "feature", area: "email", audience: ["customer", "agent"], path: "/notifications",
    title: { en: "Which updates are sent, and to whom", ar: "التحديثات المرسلة وإلى من" },
    summary: {
      en: "To the customer: ticket received, new reply from support, status changed, resolved, closed, plus reminders and a final warning while waiting for them, and a reminder to confirm a resolution. To staff: ticket assigned, customer replied, priority changed, SLA warning, SLA breach, ticket reopened, ticket escalated. Account emails: confirm email, password reset code, sign-in code, account waiting for approval, approved, rejected, promoted to staff and password expiring. Every update also appears under the bell.",
      ar: "إلى العميل: استلام التذكرة، رد جديد من الدعم، تغيّر الحالة، تم الحل، الإغلاق، إضافة إلى التذكيرات والتحذير الأخير أثناء انتظاره وتذكير بتأكيد الحل. إلى الموظفين: إسناد تذكرة، رد العميل، تغيّر الأولوية، تحذير اتفاقية الخدمة، تجاوزها، إعادة فتح التذكرة، تصعيدها. رسائل الحساب: تأكيد البريد، رمز استعادة كلمة المرور، رمز الدخول، حساب بانتظار الموافقة، موافقة، رفض، ترقية إلى موظف، وقرب انتهاء كلمة المرور. وتظهر كل تحديثات أيضًا تحت الجرس.",
    },
  },
  {
    id: "smtp-set", kind: "howto", area: "email", audience: [], perm: "manage_settings", path: "/admin/general/settings/email",
    title: { en: "Connect the email server (SMTP)", ar: "ربط خادم البريد (SMTP)" },
    summary: { en: "So ticket updates and account emails can be sent.", ar: "ليتمكن النظام من إرسال تحديثات التذاكر ورسائل الحساب." },
    steps: [
      { en: "Open **Settings** and the **Email** tab. Tick **Send system emails through this SMTP server**.", ar: "افتح **الإعدادات** وتبويب **البريد**. حدد **إرسال رسائل النظام عبر خادم SMTP هذا**." },
      { en: "Enter **SMTP host**, **Port**, **Username**, **Password**, **Sender name** and **Sender email**.", ar: "أدخل **مضيف SMTP** و**المنفذ** و**اسم المستخدم** و**كلمة المرور** و**اسم المرسل** و**بريد المرسل**." },
      { en: "Choose **Connection security**: STARTTLS (usually port 587), SSL / TLS (usually port 465), or None (not recommended).", ar: "اختر **أمان الاتصال**: STARTTLS (عادة المنفذ 587) أو SSL / TLS (عادة المنفذ 465) أو بدون (غير مستحسن)." },
      { en: "Save, then select **Send test email**. It goes to your own address using the saved settings.", ar: "احفظ ثم اختر **إرسال رسالة اختبار**. تصل إلى بريدك باستخدام الإعدادات المحفوظة." },
      { en: "When the test arrives, switch on **Send notification emails** under System rules.", ar: "عند وصول الاختبار فعّل **إرسال رسائل الإشعارات** ضمن قواعد النظام." },
    ],
    tips: [{ en: "The password is stored encrypted and never shown again. Leave it empty to keep the saved one. When SMTP is off, the system falls back to the server's Resend key if one exists.", ar: "تُخزَّن كلمة المرور مشفرة ولا تُعرض مجددًا. اتركها فارغة للإبقاء على المحفوظة. وعند تعطيل SMTP يعود النظام إلى مفتاح Resend على الخادم إن وُجد." }],
  },
  {
    id: "tpl-edit", kind: "howto", area: "email", audience: [], perm: "manage_settings", path: "/admin/general/settings/templates",
    title: { en: "Edit the wording of an email", ar: "تعديل صياغة رسالة بريد" },
    summary: { en: "Change the subject, message, button text or button link of any email.", ar: "غيّر عنوان أي رسالة ونصها ونص الزر ورابطه." },
    steps: [
      { en: "Open **Settings** and the **Email templates** tab. Choose the email from **Emails**. Each one says who receives it.", ar: "افتح **الإعدادات** وتبويب **قوالب البريد**. اختر الرسالة من **الرسائل**، وتذكر كل واحدة من يستلمها." },
      { en: "Edit the **Subject** and **Message** in English and Arabic. Select a placeholder from **You can use** to insert it where your cursor is. It fills with real information when sent.", ar: "عدّل **العنوان** و**الرسالة** بالعربية والإنجليزية. اختر متغيرًا من **يمكنك استخدام** لإدراجه عند المؤشر، ويُملأ بمعلومات حقيقية عند الإرسال." },
      { en: "Optionally change the **Button text**. Leave it empty to use the default shown.", ar: "اختياريًا غيّر **نص الزر**. اتركه فارغًا لاستخدام الافتراضي المعروض." },
      { en: "Optionally set a **Button link**: a page of this site such as /kb, a web address starting with https://, or a mailto: or tel: link. Leave it empty to keep the automatic link to the ticket or page.", ar: "اختياريًا حدد **رابط الزر**: صفحة من الموقع مثل /kb أو عنوان يبدأ بـ https:// أو رابط mailto: أو tel:. اتركه فارغًا للإبقاء على الرابط التلقائي للتذكرة أو الصفحة." },
      { en: "Check the live **Email preview**, then save. Select **Send me a test email** to receive a real one. **Restore the built-in wording** undoes your edits.", ar: "راجع **معاينة الرسالة** الحية ثم احفظ. اختر **أرسل لي رسالة اختبار** لتصلك رسالة حقيقية. و**استعادة الصياغة المدمجة** تلغي تعديلاتك." },
    ],
    tips: [{ en: "**Shared parts (greeting, button, footer)** are the same in all emails: changing them changes every email. Leave the footer empty to send no footer. Saving updates both languages.", ar: "**الأجزاء المشتركة (التحية والزر والتذييل)** واحدة في كل الرسائل، وتغييرها يغيّر كل رسالة. اترك التذييل فارغًا لعدم إرساله. والحفظ يشمل اللغتين." }],
    related: ["email-design"],
  },
  {
    id: "email-design", kind: "howto", area: "email", audience: [], perm: "manage_settings", path: "/admin/general/settings/templates",
    title: { en: "Change the look of all emails", ar: "تغيير مظهر كل رسائل البريد" },
    summary: { en: "One design for tickets, codes, passwords and account emails.", ar: "تصميم واحد لرسائل التذاكر والرموز وكلمات المرور والحساب." },
    steps: [
      { en: "Open **Settings**, **Email templates** and find **Email design**.", ar: "افتح **الإعدادات** ثم **قوالب البريد** وابحث عن **تصميم البريد**." },
      { en: "Pick the **Button and accent colour**.", ar: "اختر **لون الزر واللون المميز**." },
      { en: "Choose whether to **Show the site logo in the header**, **Show the site name in the header**, and **Show sign-in codes in a large box**. Set the corners.", ar: "اختر هل **يظهر شعار الموقع في الترويسة** و**يظهر اسم الموقع في الترويسة** و**تظهر رموز الدخول في مربع كبير**. وحدد الزوايا." },
      { en: "Check the English and Arabic (right to left) previews, then save to apply it to every email.", ar: "راجع المعاينتين الإنجليزية والعربية (من اليمين إلى اليسار) ثم احفظ لتسري على كل الرسائل." },
    ],
    tips: [{ en: "**Use the default design** restores the original look. The logo itself is set under Branding.", ar: "**استخدام التصميم الافتراضي** يعيد المظهر الأصلي. والشعار نفسه يُضبط ضمن الهوية." }],
  },

  // ---- Site settings ----
  {
    id: "branding", kind: "howto", area: "site", audience: [], perm: "manage_settings", path: "/admin/general/settings",
    title: { en: "Change the name, logo, colour and contact details", ar: "تغيير الاسم والشعار واللون وبيانات التواصل" },
    summary: { en: "The identity of the whole website.", ar: "هوية الموقع كله." },
    steps: [
      { en: "Open **Settings** and the **Branding** tab.", ar: "افتح **الإعدادات** وتبويب **الهوية**." },
      { en: "**Website**: set the name (English and Arabic) used in the browser tab, page titles and the copyright line, and the favicon.", ar: "**الموقع**: حدد الاسم (بالعربية والإنجليزية) المستخدم في تبويب المتصفح وعناوين الصفحات وسطر الحقوق، وأيقونة المتصفح." },
      { en: "**Header**: set the name, subtitle and icon or logo shown at the top of every page and on the staff sidebar.", ar: "**الترويسة**: حدد الاسم والعنوان الفرعي والأيقونة أو الشعار الظاهرة في أعلى كل صفحة وفي الشريط الجانبي للموظفين." },
      { en: "**Footer and contact**: add extra footer text, contact email, phone and working hours. Leave a field empty to hide it.", ar: "**التذييل والتواصل**: أضف نصًا للتذييل وبريد التواصل والهاتف وساعات العمل. اترك الحقل فارغًا لإخفائه." },
      { en: "**Colour**: choose one main colour. The site makes the darker and lighter shades itself. White text must stay readable on it.", ar: "**اللون**: اختر لونًا رئيسيًا واحدًا. ينشئ الموقع الدرجات الأغمق والأفتح بنفسه. ويجب أن يبقى النص الأبيض مقروءًا عليه." },
      { en: "**Page texts**: optionally set the home page heading and intro and the sign-in notice. Leave empty for the standard text. Save.", ar: "**نصوص الصفحات**: اختياريًا حدد عنوان الصفحة الرئيسية ومقدمتها وتنبيه تسجيل الدخول. اتركها فارغة للنص القياسي. ثم احفظ." },
    ],
    tips: [{ en: "Images: PNG, JPG, SVG or WebP, up to 1 MB. Square works best.", ar: "الصور: PNG أو JPG أو SVG أو WebP حتى 1 ميجابايت، والمربعة أفضل." }],
  },
  {
    id: "home-page", kind: "howto", area: "site", audience: [], perm: "manage_settings", path: "/admin/general/settings/home",
    title: { en: "Edit the Popular help articles row on the home page", ar: "تعديل صف المقالات الشائعة في الصفحة الرئيسية" },
    summary: { en: "What signed-in customers see under the hero.", ar: "ما يراه العملاء المسجلون تحت الواجهة الرئيسية." },
    steps: [
      { en: "Open **Settings** and the **Home page** tab.", ar: "افتح **الإعدادات** وتبويب **الصفحة الرئيسية**." },
      { en: "Under **Popular help articles** edit the **Heading**. Leave it empty to use the standard wording shown in grey.", ar: "ضمن **مقالات المساعدة الشائعة** عدّل **العنوان**. اتركه فارغًا لاستخدام الصياغة القياسية الظاهرة بالرمادي." },
      { en: "Save.", ar: "احفظ." },
    ],
    tips: [{ en: "The row picks the most helpful articles each customer is allowed to read. The hero title and intro are under Branding.", ar: "يختار الصف أكثر المقالات فائدة مما يحق للعميل قراءته. وعنوان الواجهة ومقدمتها ضمن الهوية." }],
  },
  {
    id: "menus", kind: "howto", area: "site", audience: [], perm: "manage_settings", path: "/admin/general/settings/menus",
    title: { en: "Add or reorder menu links", ar: "إضافة روابط القوائم أو إعادة ترتيبها" },
    summary: { en: "Five menus: customer header, customer footer, console, Administration and General.", ar: "خمس قوائم: ترويسة العملاء وتذييلهم ولوحة الموظفين والإدارة والعام." },
    steps: [
      { en: "Open **Settings** and the **Menus** tab. Choose the menu to edit.", ar: "افتح **الإعدادات** وتبويب **القوائم**. اختر القائمة المراد تعديلها." },
      { en: "Add a link or, in the customer header, a **Group** that shows a drop-down list of sub-items.", ar: "أضف رابطًا أو، في ترويسة العملاء، **مجموعة** تعرض قائمة منسدلة لعناصر فرعية." },
      { en: "Enter the **Name** in English and Arabic and the link: a page of this site (for example /kb), a web address, mailto:name@example.com or tel:+201012345678. Tick **Open in a new tab** if wanted.", ar: "أدخل **الاسم** بالعربية والإنجليزية والرابط: صفحة من الموقع (مثل /kb) أو عنوان ويب أو mailto:name@example.com أو tel:+201012345678. وحدد **فتح في تبويب جديد** عند الحاجة." },
      { en: "Choose who sees it and the order, then save.", ar: "اختر من يراه والترتيب ثم احفظ." },
    ],
    tips: [{ en: "Built-in console and administration items still show only to people with the matching permission. Custom links in the console menus show to all staff.", ar: "تبقى عناصر لوحة الموظفين والإدارة المدمجة ظاهرة فقط لأصحاب الصلاحية المناسبة، أما الروابط المخصصة فتظهر لكل الموظفين." }],
  },
  {
    id: "messages", kind: "howto", area: "site", audience: [], perm: "manage_settings", path: "/admin/general/settings/messages",
    title: { en: "Change the wording of any message in the system", ar: "تغيير صياغة أي رسالة في النظام" },
    summary: { en: "Every message, notice and error can be reworded in both languages.", ar: "يمكن إعادة صياغة كل رسالة وتنبيه وخطأ بالعربية والإنجليزية." },
    steps: [
      { en: "Open **Settings** and the **System messages** tab.", ar: "افتح **الإعدادات** وتبويب **رسائل النظام**." },
      { en: "Search, or filter by **Area** and **Type**, and select a message. Its description says where it appears.", ar: "ابحث أو رشّح حسب **المنطقة** و**النوع** ثم اختر رسالة. ويبيّن وصفها أين تظهر." },
      { en: "Edit the **English** and **Arabic** wording. Use the toolbar for bold, italic, lists, links and anchors. Placeholders such as {siteName} are filled in automatically.", ar: "عدّل الصياغة **الإنجليزية** و**العربية**. استخدم الشريط للغامق والمائل والقوائم والروابط والمراسي. وتُملأ المتغيرات مثل {siteName} تلقائيًا." },
      { en: "Check the **Preview** and select **Save**. **Reset to standard** brings back the original wording.", ar: "راجع **المعاينة** ثم اختر **حفظ**. و**إعادة إلى القياسي** تعيد الصياغة الأصلية." },
    ],
    tips: [{ en: "Edited messages are marked **Edited** in the list. Press Enter twice for a new paragraph.", ar: "تُعلَّم الرسائل المعدلة بـ**معدّلة** في القائمة. اضغط Enter مرتين لفقرة جديدة." }],
  },
  {
    id: "kb-write", kind: "howto", area: "kb", audience: [], perm: "manage_kb", path: "/admin/kb",
    title: { en: "Write and publish a knowledge base article", ar: "كتابة مقال في قاعدة المعرفة ونشره" },
    summary: { en: "Answer common questions once, in both languages.", ar: "أجب عن الأسئلة الشائعة مرة واحدة بالعربية والإنجليزية." },
    steps: [
      { en: "Open **Knowledge base** under Administration. If needed, first select **Add category**.", ar: "افتح **قاعدة المعرفة** ضمن الإدارة. وإن لزم اختر أولًا **إضافة تصنيف**." },
      { en: "Select **Add article**. Enter the **Title** and **Body** in English and Arabic and choose the **Category**.", ar: "اختر **إضافة مقال**. أدخل **العنوان** و**المحتوى** بالإنجليزية والعربية واختر **التصنيف**." },
      { en: "Choose **Who can read it**: Everyone (no sign-in), Signed-in users, or Staff only.", ar: "اختر **من يستطيع قراءته**: الجميع (دون دخول) أو المستخدمون المسجلون أو الموظفون فقط." },
      { en: "Set the **Status**: Draft, Published or Archived. Only Published articles are visible. Select **Save**.", ar: "حدد **الحالة**: مسودة أو منشور أو مؤرشف. تظهر المنشورة فقط. ثم اختر **حفظ**." },
    ],
    tips: [{ en: "The Address (slug) becomes the article's web address. Customers rate each article, so you can see which ones help.", ar: "يصبح العنوان (slug) رابط المقال. ويقيّم العملاء كل مقال لتعرف أيها مفيد." }],
  },
];

export const ADMIN_B_FLOWS: Flow[] = [
  {
    id: "f-reg-approval", area: "system", audience: [], perm: "manage_settings",
    title: { en: "Registration: Open, administrator approves", ar: "التسجيل: مفتوح والمدير يوافق" },
    summary: { en: "The administrator chooses the organization when approving.", ar: "يحدد المدير المؤسسة عند الموافقة." },
    nodes: [
      { label: { en: "Customer creates account", ar: "العميل ينشئ حسابًا" }, tone: "a" },
      { label: { en: "Confirms email", ar: "يؤكد البريد" } },
      { label: { en: "Administrator assigns organization", ar: "المدير يحدد المؤسسة" }, tone: "d" },
      { label: { en: "Approved, customer emailed", ar: "موافقة وبريد للعميل" }, tone: "o" },
    ],
  },
  {
    id: "f-reg-pick-approval", area: "system", audience: [], perm: "manage_settings",
    title: { en: "Registration: customer picks, admin approves", ar: "التسجيل: العميل يختار والمدير يوافق" },
    summary: { en: "The admins of the chosen branch or organization are emailed to approve.", ar: "يصل بريد إلى مديري الفرع أو المؤسسة المختارة للموافقة." },
    nodes: [
      { label: { en: "Customer picks organization and branch", ar: "العميل يختار المؤسسة والفرع" }, tone: "a" },
      { label: { en: "Confirms email", ar: "يؤكد البريد" } },
      { label: { en: "Branch or organization admin approves", ar: "مدير الفرع أو المؤسسة يوافق" }, tone: "d" },
      { label: { en: "Customer can sign in", ar: "يمكن للعميل الدخول" }, tone: "o" },
    ],
  },
  {
    id: "f-reg-auto", area: "system", audience: [], perm: "manage_settings",
    title: { en: "Registration: customer picks, no approval", ar: "التسجيل: العميل يختار دون موافقة" },
    summary: { en: "The fastest mode. Turn on the captcha because nothing else filters bots.", ar: "أسرع وضع. فعّل الكابتشا لأنه لا حاجز غيرها ضد الروبوتات." },
    nodes: [
      { label: { en: "Customer picks organization and branch", ar: "العميل يختار المؤسسة والفرع" }, tone: "a" },
      { label: { en: "Confirms email", ar: "يؤكد البريد" } },
      { label: { en: "Signs in at once", ar: "يدخل فورًا" }, tone: "o" },
    ],
  },
  {
    id: "f-reg-closed", area: "system", audience: [], perm: "manage_settings",
    title: { en: "Registration: Closed", ar: "التسجيل: مغلق" },
    summary: { en: "No Create account option anywhere. Accounts are created by hand.", ar: "لا خيار «إنشاء حساب» في أي مكان. تُنشأ الحسابات يدويًا." },
    nodes: [
      { label: { en: "Branch or organization admin adds customer", ar: "مدير الفرع أو المؤسسة يضيف العميل" }, tone: "a" },
      { label: { en: "Temporary password given", ar: "تسليم كلمة مرور مؤقتة" } },
      { label: { en: "Customer signs in and changes it", ar: "العميل يدخل ويغيّرها" }, tone: "o" },
    ],
  },
  {
    id: "f-timers", area: "system", audience: [], perm: "manage_settings",
    title: { en: "Waiting for the customer: reminders and closing", ar: "انتظار العميل: التذكيرات والإغلاق" },
    summary: { en: "Each step runs the number of days you set. A step set to 0 is skipped. The customer replying stops the sequence.", ar: "تعمل كل خطوة بعد عدد الأيام الذي تحدده، والخطوة المضبوطة على 0 تُتخطى. ورد العميل يوقف التسلسل." },
    nodes: [
      { label: { en: "Pending customer", ar: "بانتظار العميل" }, tone: "d" },
      { label: { en: "First reminder", ar: "التذكير الأول" } },
      { label: { en: "Second reminder", ar: "التذكير الثاني" } },
      { label: { en: "Final warning", ar: "التحذير الأخير" }, tone: "d" },
      { label: { en: "Closed: No customer response", ar: "مغلقة: عدم رد العميل" }, tone: "o" },
    ],
  },
  {
    id: "f-pw-expiry", area: "system", audience: [], perm: "manage_settings",
    title: { en: "Password expiry", ar: "انتهاء كلمة المرور" },
    summary: { en: "Up to three warning emails, then a renewal by one-time code at the next sign-in.", ar: "حتى ثلاث رسائل تحذير ثم تجديد برمز لمرة واحدة عند الدخول التالي." },
    nodes: [
      { label: { en: "Warning emails", ar: "رسائل التحذير" }, tone: "d" },
      { label: { en: "Password expires", ar: "تنتهي كلمة المرور" }, tone: "d" },
      { label: { en: "Next sign-in: code by email", ar: "عند الدخول: رمز بالبريد" }, tone: "a" },
      { label: { en: "Choose new password", ar: "اختيار كلمة مرور جديدة" }, tone: "o" },
    ],
  },
  {
    id: "f-signin-code", area: "system", audience: [], perm: "manage_settings",
    title: { en: "Signing in with a one-time code", ar: "الدخول برمز لمرة واحدة" },
    summary: { en: "Too many wrong attempts lock the code. A new code can be requested after the waiting time.", ar: "تقفل المحاولات الخاطئة الكثيرة الرمز، ويمكن طلب رمز جديد بعد مدة الانتظار." },
    nodes: [
      { label: { en: "Enter email", ar: "إدخال البريد" }, tone: "a" },
      { label: { en: "Code emailed", ar: "إرسال الرمز بالبريد" } },
      { label: { en: "Enter code in time", ar: "إدخال الرمز في وقته" } },
      { label: { en: "Signed in, logged", ar: "تسجيل الدخول والتدوين" }, tone: "o" },
    ],
  },
  {
    id: "f-handover", area: "system", audience: [],
    title: { en: "Handing over to a new owner", ar: "التسليم إلى مالك جديد" },
    summary: { en: "Do this once when the system changes hands.", ar: "يُنفَّذ مرة واحدة عند انتقال النظام إلى جهة أخرى." },
    nodes: [
      { label: { en: "Add the new administrator as staff", ar: "إضافة المدير الجديد كموظف" }, tone: "a" },
      { label: { en: "Transfer administrator", ar: "نقل المدير" }, tone: "d" },
      { label: { en: "Delete demo data", ar: "حذف البيانات التجريبية" } },
      { label: { en: "New owner starts clean", ar: "المالك الجديد يبدأ من الصفر" }, tone: "o" },
    ],
  },
  {
    id: "f-email-pipeline", area: "email", audience: [], perm: "manage_settings",
    title: { en: "How an email gets sent", ar: "كيف تُرسل رسالة البريد" },
    summary: { en: "An event happens, the template for the recipient's language is filled in, wrapped in the email design, and sent through your SMTP server. Until SMTP works and Send notification emails is on, emails wait in the queue.", ar: "يقع حدث فيُملأ القالب بلغة المستلم ويُغلَّف بتصميم البريد ويُرسل عبر خادم SMTP. وإلى أن يعمل SMTP ويُفعَّل إرسال الإشعارات تنتظر الرسائل في الطابور." },
    nodes: [
      { label: { en: "Event (reply, status, SLA…)", ar: "حدث (رد أو حالة أو اتفاقية خدمة…)" }, tone: "a" },
      { label: { en: "Template and language", ar: "القالب واللغة" } },
      { label: { en: "Email design", ar: "تصميم البريد" } },
      { label: { en: "SMTP server", ar: "خادم SMTP" }, tone: "d" },
      { label: { en: "Delivered + bell", ar: "تسليم وإشعار بالجرس" }, tone: "o" },
    ],
  },
];
