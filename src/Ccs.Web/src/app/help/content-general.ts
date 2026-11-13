import type { Article, Flow } from "./types";

const c = ["customer"] as const;
const s = ["agent"] as const;
const both = ["customer", "agent"] as const;

/** Account, customers, knowledge base, dashboard and reports. */
export const GENERAL_ARTICLES: Article[] = [
  // ---- Account (everyone) ----
  {
    id: "a-profile", kind: "howto", area: "account", audience: [...both], path: "/account",
    title: { en: "Update your profile", ar: "تحديث ملفك الشخصي" },
    summary: { en: "Keep your name, phone and language current.", ar: "أبقِ اسمك وهاتفك ولغتك محدّثة." },
    steps: [
      { en: "Open **My Account** from the account menu.", ar: "افتح **حسابي** من قائمة الحساب." },
      { en: "Edit your name, phone number or preferred language.", ar: "عدّل اسمك أو رقم هاتفك أو لغتك المفضلة." },
      { en: "Select **Save changes**.", ar: "اختر **حفظ التغييرات**." },
    ],
    tips: [{ en: "Your email is your sign-in name and cannot be changed here. You can also sign in with your 11-digit mobile number starting with 01.", ar: "بريدك الإلكتروني هو اسم الدخول ولا يمكن تغييره من هنا. ويمكنك أيضًا الدخول برقم جوالك المكوّن من 11 رقمًا ويبدأ بـ 01." }],
  },
  {
    id: "a-language", kind: "howto", area: "account", audience: [...both],
    title: { en: "Switch between English and Arabic", ar: "التبديل بين العربية والإنجليزية" },
    summary: { en: "The whole system, including emails, follows your language.", ar: "يتبع النظام كله لغتك، بما في ذلك الرسائل البريدية." },
    steps: [
      { en: "Use the language switch in the page header.", ar: "استخدم مفتاح اللغة في ترويسة الصفحة." },
      { en: "To make the choice permanent, set **Preferred language** in **My Account**.", ar: "لتثبيت الاختيار حدّد **اللغة المفضلة** في **حسابي**." },
    ],
    tips: [{ en: "Arabic pages read right to left.", ar: "تُقرأ الصفحات العربية من اليمين إلى اليسار." }],
  },
  {
    id: "a-password", kind: "howto", area: "account", audience: [...both], path: "/account",
    title: { en: "Change your password", ar: "تغيير كلمة المرور" },
    summary: { en: "Use at least 10 characters.", ar: "استخدم 10 أحرف على الأقل." },
    steps: [
      { en: "Open **My Account** and find **Password**.", ar: "افتح **حسابي** وابحث عن **كلمة المرور**." },
      { en: "Enter your current password and the new one twice.", ar: "أدخل كلمة المرور الحالية ثم الجديدة مرتين." },
      { en: "Save. Use the eye button to check what you typed.", ar: "احفظ. استخدم زر العين للتحقق مما كتبته." },
    ],
    tips: [{ en: "An administrator may require passwords to be renewed after a set period. You will then be asked to renew it by a code sent to your email.", ar: "قد يطلب المدير تجديد كلمات المرور بعد مدة محددة، وعندها يُطلب منك التجديد برمز يصل إلى بريدك." }],
  },
  {
    id: "a-forgot", kind: "howto", area: "account", audience: [...both], path: "/forgot-password",
    title: { en: "Reset a forgotten password", ar: "استعادة كلمة مرور منسية" },
    summary: { en: "Get back in without help.", ar: "استعد الدخول دون مساعدة." },
    steps: [
      { en: "On the sign-in page select **Forgot your password?**.", ar: "في صفحة الدخول اختر **نسيت كلمة المرور؟**." },
      { en: "Enter your email and submit. We email you a reset link.", ar: "أدخل بريدك الإلكتروني وأرسل. سيصلك رابط لإعادة التعيين." },
      { en: "Open the link and choose a new password.", ar: "افتح الرابط واختر كلمة مرور جديدة." },
    ],
  },
  {
    id: "a-code", kind: "howto", area: "account", audience: [...both], path: "/login/code",
    title: { en: "Sign in with a one-time code", ar: "الدخول برمز لمرة واحدة" },
    summary: { en: "No password needed, when the administrator allows it.", ar: "دون كلمة مرور، عندما يسمح المدير بذلك." },
    steps: [
      { en: "On the sign-in page select **Email me a one-time code**.", ar: "في صفحة الدخول اختر **أرسل لي رمزًا لمرة واحدة بالبريد**." },
      { en: "Enter your email. We send a short code.", ar: "أدخل بريدك الإلكتروني. سنرسل رمزًا قصيرًا." },
      { en: "Type the code to sign in.", ar: "اكتب الرمز لتسجيل الدخول." },
    ],
  },
  {
    id: "a-mfa", kind: "howto", area: "account", audience: [...both], path: "/account",
    title: { en: "Turn on two-step verification", ar: "تفعيل التحقق بخطوتين" },
    summary: { en: "Protect your account with a code from your phone. It is optional.", ar: "احمِ حسابك برمز من هاتفك. وهو اختياري." },
    steps: [
      { en: "Install an authenticator app such as Google Authenticator or Microsoft Authenticator.", ar: "ثبّت تطبيق مصادقة مثل Google Authenticator أو Microsoft Authenticator." },
      { en: "In **My Account** find **Two-step verification** and select **Turn on**.", ar: "في **حسابي** ابحث عن **التحقق بخطوتين** واختر **تشغيل**." },
      { en: "Scan the QR code with the app, or type the secret key.", ar: "امسح رمز QR بالتطبيق، أو اكتب المفتاح السري." },
      { en: "Enter the 6-digit code the app shows and select **Confirm**.", ar: "أدخل الرمز المكوّن من 6 أرقام الذي يعرضه التطبيق واختر **تأكيد**." },
    ],
    tips: [{ en: "From then on, signing in asks for a code after your password. To stop, select **Turn off**.", ar: "بعد ذلك يطلب الدخول رمزًا بعد كلمة المرور. وللإيقاف اختر **إيقاف**." }],
  },
  {
    id: "a-notifications", kind: "feature", area: "account", audience: [...both], path: "/notifications",
    title: { en: "Notifications", ar: "الإشعارات" },
    summary: {
      en: "The bell in the header shows how many updates are unread. The Notifications page lists every update on your tickets, such as new replies, status changes, assignments and SLA warnings. Select one to open the ticket, or use **Mark all as read**. The same updates reach you by email.",
      ar: "يعرض الجرس في الترويسة عدد التحديثات غير المقروءة. تسرد صفحة الإشعارات كل تحديثات تذاكرك مثل الردود الجديدة وتغيّر الحالة والإسناد وتحذيرات اتفاقية الخدمة. اختر إشعارًا لفتح التذكرة أو استخدم **تعليم الكل كمقروء**. وتصلك التحديثات نفسها بالبريد.",
    },
  },
  {
    id: "a-register", kind: "howto", area: "account", audience: [...c], path: "/register",
    title: { en: "Create a customer account", ar: "إنشاء حساب عميل" },
    summary: { en: "New here? Register, verify and wait for approval.", ar: "جديد هنا؟ سجّل وأكّد بريدك وانتظر الموافقة." },
    steps: [
      { en: "Select **Create an account** on the sign-in page.", ar: "اختر **إنشاء حساب** في صفحة الدخول." },
      { en: "Enter your name, email, mobile number, organization and branch, and a password of at least 10 characters.", ar: "أدخل اسمك وبريدك ورقم جوالك ومؤسستك وفرعك وكلمة مرور من 10 أحرف على الأقل." },
      { en: "Open the verification link we email you.", ar: "افتح رابط التحقق الذي أرسلناه إلى بريدك." },
      { en: "Wait for the administrator to approve your account. You are emailed, then you can sign in.", ar: "انتظر موافقة المدير على حسابك. ستصلك رسالة بعدها يمكنك الدخول." },
    ],
  },

  {
    id: "a-signin", kind: "howto", area: "account", audience: [...both], path: "/login",
    title: { en: "Sign in", ar: "تسجيل الدخول" },
    summary: { en: "Use your email or mobile number and your password.", ar: "استخدم بريدك أو رقم جوالك وكلمة المرور." },
    steps: [
      { en: "Open the sign-in page and enter your **Email or phone number** (no need to type +2) and your **Password**.", ar: "افتح صفحة الدخول وأدخل **البريد أو رقم الهاتف** (دون كتابة +2) و**كلمة المرور**." },
      { en: "Select **Sign in**.", ar: "اختر **تسجيل الدخول**." },
      { en: "If you turned on two-step verification, enter the 6-digit code from your authenticator app.", ar: "إذا فعّلت التحقق بخطوتين فأدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة." },
    ],
    tips: [
      { en: "A notice appears if your account is waiting for approval or is suspended. Contact support if you need help.", ar: "يظهر تنبيه إذا كان حسابك بانتظار الموافقة أو موقوفًا. تواصل مع الدعم عند الحاجة." },
      { en: "Forgot your password? Use **Forgot your password?** under the form.", ar: "نسيت كلمة المرور؟ استخدم **نسيت كلمة المرور؟** أسفل النموذج." },
    ],
    related: ["a-forgot", "a-code", "a-mfa"],
  },
  {
    id: "c-home", kind: "feature", area: "tickets", audience: [...c], path: "/",
    title: { en: "Your home page", ar: "صفحتك الرئيسية" },
    summary: {
      en: "A welcome with shortcuts to create a ticket and view your tickets, a snapshot of your tickets (total, open, waiting for you, resolved), your most recent tickets, and popular help articles. Search the knowledge base before opening a ticket, because most questions already have an answer.",
      ar: "ترحيب مع اختصارات لإنشاء تذكرة وعرض تذاكرك، ولمحة عن تذاكرك (الإجمالي والمفتوحة وبانتظار ردك والمحلولة)، وأحدث تذاكرك، والمقالات الشائعة. ابحث في قاعدة المعرفة قبل فتح تذكرة فكثير من الأسئلة لها إجابة جاهزة.",
    },
  },
  {
    id: "s-notifications", kind: "feature", area: "account", audience: [...s], path: "/console/notifications",
    title: { en: "Notifications (staff)", ar: "الإشعارات (الموظفون)" },
    summary: {
      en: "The bell in the top bar shows unread updates: tickets assigned to you, customer replies, priority changes, SLA warnings and breaches, reopened and escalated tickets. Select one to open the ticket, or use **Mark all as read**. The same updates reach you by email.",
      ar: "يعرض الجرس في الشريط العلوي التحديثات غير المقروءة: التذاكر المسندة إليك وردود العملاء وتغيّر الأولوية وتحذيرات اتفاقية الخدمة وتجاوزاتها والتذاكر المعاد فتحها والمصعّدة. اختر تحديثًا لفتح التذكرة أو استخدم **تعليم الكل كمقروء**. وتصلك التحديثات نفسها بالبريد.",
    },
  },

  // ---- Customers (staff) ----
  {
    id: "s-customers", kind: "feature", area: "customers", audience: [...s], path: "/console/customers",
    title: { en: "Customers", ar: "العملاء" },
    summary: {
      en: "Everyone who registered as a customer inside your access, with organization, branch, status and ticket counts. Search by name, email, phone or organization. Open a customer to see the full ticket history and to edit their details.",
      ar: "كل من سجّل كعميل ضمن نطاق صلاحيتك مع المؤسسة والفرع والحالة وعدد التذاكر. ابحث بالاسم أو البريد أو الهاتف أو المؤسسة. افتح العميل لترى سجل تذاكره الكامل ولتعدّل بياناته.",
    },
    tips: [{ en: "A customer with tickets cannot be deleted. Suspend the account instead.", ar: "لا يمكن حذف عميل لديه تذاكر. أوقف حسابه بدلًا من ذلك." }],
  },
  {
    id: "s-approve", kind: "howto", area: "customers", audience: [], perm: "approve_customers", path: "/console/approvals",
    title: { en: "Approve a new customer account", ar: "الموافقة على حساب عميل جديد" },
    summary: { en: "New customers wait here after verifying their email.", ar: "ينتظر العملاء الجدد هنا بعد تأكيد بريدهم." },
    steps: [
      { en: "Open **Account approvals**. Each waiting customer shows name, email, phone and registration date.", ar: "افتح **موافقات الحسابات**. يعرض كل عميل منتظر اسمه وبريده وهاتفه وتاريخ تسجيله." },
      { en: "Choose the customer's **Organization** (and branch if needed).", ar: "اختر **مؤسسة** العميل (والفرع عند الحاجة)." },
      { en: "Select **Approve**, or **Reject** to refuse the account. The customer is emailed either way.", ar: "اختر **موافقة** أو **رفض** لرفض الحساب. يصل العميل بريد في الحالتين." },
    ],
    tips: [{ en: "The Approved accounts list below shows who approved each customer and when.", ar: "تعرض قائمة الحسابات المعتمدة في الأسفل من وافق على كل عميل ومتى." }],
  },
  {
    id: "s-people", kind: "feature", area: "customers", audience: [...s], path: "/console/people",
    title: { en: "People in your branch or organization", ar: "الأشخاص في فرعك أو مؤسستك" },
    summary: {
      en: "For branch and organization administrators. Add, edit, suspend or reactivate the customers, agents and team leaders inside the branches and organizations you manage. The page appears only when the main Administrator has given you a scope (when adding you, they tick Organization admin or Branch admin and choose your organizations or branches). Its menu item is People.",
      ar: "لمديري الفروع والمؤسسات. أضف العملاء والموظفين وقادة الفرق داخل الفروع والمؤسسات التي تديرها، وعدّلهم أو أوقفهم أو أعد تفعيلهم. تظهر الصفحة فقط عندما يمنحك المدير الرئيسي نطاقًا (عند إضافتك يحدد «مدير المؤسسة» أو «مدير الفرع» ويختار مؤسساتك أو فروعك). وبند القائمة هو «الأشخاص».",
    },
  },

  // ---- Knowledge base ----
  {
    id: "kb-read", kind: "howto", area: "kb", audience: [...both], path: "/kb",
    title: { en: "Find an answer in the knowledge base", ar: "العثور على إجابة في قاعدة المعرفة" },
    summary: { en: "Many questions are answered before you need a ticket.", ar: "كثير من الأسئلة تُجاب قبل الحاجة إلى تذكرة." },
    steps: [
      { en: "Open **Knowledge base** in the menu.", ar: "افتح **قاعدة المعرفة** من القائمة." },
      { en: "Search by keyword, or choose a category.", ar: "ابحث بكلمة مفتاحية أو اختر تصنيفًا." },
      { en: "Open an article. At the end, answer **Was this article helpful?** (sign in to vote).", ar: "افتح مقالًا. وفي نهايته أجب عن **هل كان هذا المقال مفيدًا؟** (سجّل الدخول للتصويت)." },
      { en: "Still stuck? Select **Open a ticket**.", ar: "ما زلت بحاجة لمساعدة؟ اختر **فتح تذكرة**." },
    ],
  },
  {
    id: "kb-manage", kind: "feature", area: "kb", audience: [], perm: "manage_kb", path: "/admin/kb",
    title: { en: "Manage knowledge base articles", ar: "إدارة مقالات قاعدة المعرفة" },
    summary: {
      en: "Create, edit, publish and unpublish articles and their categories, in English and Arabic. Only published articles are visible to customers. Votes on helpfulness show which articles need work.",
      ar: "أنشئ المقالات والتصنيفات وعدّلها وانشرها وأوقف نشرها بالعربية والإنجليزية. تظهر للعملاء المقالات المنشورة فقط. وتبيّن أصوات الفائدة المقالات التي تحتاج تحسينًا.",
    },
  },

  // ---- Dashboard and reports ----
  {
    id: "r-dashboard", kind: "feature", area: "reports", audience: [...s], path: "/console/dashboard",
    title: { en: "Dashboard", ar: "لوحة المتابعة" },
    summary: {
      en: "A summary of the last 30 days: total, new, in progress, resolved and overdue tickets, a trend chart of created against resolved, SLA compliance, recent tickets, agent workload, average resolution time and tickets per organization and branch. Quick actions jump to unassigned, assigned to me and SLA breached tickets.",
      ar: "ملخص لآخر 30 يومًا: إجمالي التذاكر والجديدة وقيد المعالجة والمحلولة والمتأخرة، ومخطط اتجاه للمنشأة مقابل المحلولة، والالتزام باتفاقية الخدمة، وأحدث التذاكر، وحمل العمل على الموظفين، ومتوسط زمن الحل، والتذاكر لكل مؤسسة وفرع. تنقلك الإجراءات السريعة إلى غير المسندة والمسندة إليّ والمتجاوزة.",
    },
  },
  {
    id: "r-reports", kind: "howto", area: "reports", audience: [], perm: ["reports_own", "reports_all"], path: "/console/reports",
    title: { en: "Run a report", ar: "تشغيل تقرير" },
    summary: { en: "Volumes, response times, satisfaction and SLA results for tickets your role can see.", ar: "الأحجام وأزمنة الاستجابة والرضا ونتائج اتفاقية الخدمة للتذاكر التي تراها صلاحيتك." },
    steps: [
      { en: "Open **Reports** and choose the **Period**.", ar: "افتح **التقارير** واختر **الفترة**." },
      { en: "Read the totals, average first response and average time to resolve, then the breakdowns by status, priority, category and team.", ar: "اقرأ الإجماليات ومتوسط أول استجابة ومتوسط زمن الحل ثم التوزيعات حسب الحالة والأولوية والتصنيف والفريق." },
      { en: "Check **Agent performance**, **Team performance** and **Customer satisfaction** for who is doing what.", ar: "راجع **أداء الموظفين** و**أداء الفرق** و**رضا العملاء** لمعرفة من يفعل ماذا." },
      { en: "Select **Export CSV** to take the data into Excel.", ar: "اختر **تصدير CSV** لنقل البيانات إلى Excel." },
    ],
    tips: [{ en: "Times are elapsed time, not business hours. Tickets closed as cancelled, duplicate or spam are not counted in SLA results.", ar: "الأزمنة مدة فعلية وليست ساعات عمل. ولا تُحتسب التذاكر المغلقة كملغاة أو مكررة أو مزعجة في نتائج اتفاقية الخدمة." }],
  },
  {
    id: "r-sla-report", kind: "feature", area: "reports", audience: [...s], path: "/console/sla",
    title: { en: "SLA report", ar: "تقرير اتفاقية الخدمة" },
    summary: {
      en: "How well deadlines are being met: first response met, resolution met (target 90%), and a list of tickets at risk that are breached or due soon. Reopened tickets are counted in separate SLA cycles so a missed first deadline is never hidden.",
      ar: "مدى الالتزام بالمواعيد: أول استجابة تحققت، والحل تحقق (الهدف 90%)، وقائمة بالتذاكر المعرضة للخطر المتجاوزة أو التي تستحق قريبًا. تُحتسب التذاكر المعاد فتحها في دورات منفصلة لئلا يُخفى موعد أول فائت.",
    },
  },
];

export const GENERAL_FLOWS: Flow[] = [
  {
    id: "f-journey-customer", area: "tickets", audience: [...c],
    title: { en: "The journey of your ticket", ar: "رحلة تذكرتك" },
    summary: { en: "What you see at each stage. When the team needs your answer it shows Waiting for you.", ar: "ما تراه في كل مرحلة. عندما يحتاج الفريق ردك تظهر «بانتظار ردك»." },
    nodes: [
      { label: { en: "Received", ar: "تم الاستلام" }, tone: "a" },
      { label: { en: "Open", ar: "مفتوحة" } },
      { label: { en: "In progress", ar: "قيد المعالجة" } },
      { label: { en: "Waiting for you", ar: "بانتظار ردك" }, tone: "d" },
      { label: { en: "Resolved", ar: "تم الحل" }, tone: "o" },
      { label: { en: "Closed", ar: "مغلقة" }, tone: "o" },
    ],
  },
  {
    id: "f-reopen", area: "tickets", audience: [...c],
    title: { en: "Not fixed: reopen or follow up", ar: "لم تُحل: إعادة فتح أو متابعة" },
    summary: { en: "Within the reopen period you can reopen. After it, start a follow-up ticket that links back.", ar: "خلال مدة إعادة الفتح يمكنك إعادة فتح التذكرة، وبعدها ابدأ تذكرة متابعة مرتبطة بها." },
    nodes: [
      { label: { en: "Resolved or closed", ar: "تم الحل أو مغلقة" }, tone: "o" },
      { label: { en: "Still broken", ar: "المشكلة قائمة" }, tone: "d" },
      { label: { en: "Reopen (in period)", ar: "إعادة فتح (ضمن المدة)" }, tone: "a" },
      { label: { en: "Reopened", ar: "معاد فتحها" } },
    ],
  },
  {
    id: "f-cancel", area: "tickets", audience: [...c],
    title: { en: "Cancelling a ticket", ar: "إلغاء تذكرة" },
    summary: { en: "Cancelled at once if untouched. Otherwise the team reviews your request and replies.", ar: "تُلغى فورًا إن لم يبدأ العمل عليها، وإلا يراجع الفريق طلبك ويرد." },
    nodes: [
      { label: { en: "Cancel ticket", ar: "إلغاء التذكرة" }, tone: "a" },
      { label: { en: "Cancellation requested", ar: "تم طلب الإلغاء" }, tone: "d" },
      { label: { en: "Team approves: closed", ar: "يوافق الفريق: تُغلق" }, tone: "o" },
    ],
  },
  {
    id: "f-register", area: "account", audience: [...c],
    title: { en: "Getting an account", ar: "الحصول على حساب" },
    summary: { en: "You can sign in only after the administrator approves.", ar: "لا يمكنك الدخول إلا بعد موافقة المدير." },
    nodes: [
      { label: { en: "Create an account", ar: "إنشاء حساب" }, tone: "a" },
      { label: { en: "Verify your email", ar: "تأكيد البريد" } },
      { label: { en: "Administrator approval", ar: "موافقة المدير" }, tone: "d" },
      { label: { en: "Sign in", ar: "تسجيل الدخول" }, tone: "o" },
    ],
  },
  {
    id: "f-journey-staff", area: "tickets", audience: [...s],
    title: { en: "Ticket lifecycle", ar: "دورة حياة التذكرة" },
    summary: { en: "The usual path. Pending customer pauses the SLA clock. Reopened returns the ticket to work.", ar: "المسار المعتاد. «بانتظار العميل» توقف ساعة اتفاقية الخدمة، و«معاد فتحها» تعيد التذكرة إلى العمل." },
    nodes: [
      { label: { en: "New", ar: "جديدة" }, tone: "a" },
      { label: { en: "Open", ar: "مفتوحة" } },
      { label: { en: "In progress", ar: "قيد المعالجة" } },
      { label: { en: "Pending customer / internal", ar: "بانتظار العميل / جهة داخلية" }, tone: "d" },
      { label: { en: "Resolved", ar: "تم الحل" }, tone: "o" },
      { label: { en: "Closed", ar: "مغلقة" }, tone: "o" },
    ],
  },
  {
    id: "f-assign", area: "tickets", audience: [...s],
    title: { en: "How a new ticket finds its owner", ar: "كيف تجد التذكرة الجديدة مسؤولها" },
    summary: { en: "The category sets the team. Auto-assign then picks the person with the fewest open tickets. Otherwise the ticket waits in the team queue for someone to take it.", ar: "يحدد التصنيف الفريق، ثم يختار الإسناد التلقائي صاحب أقل عدد من التذاكر المفتوحة، وإلا تنتظر التذكرة في قائمة الفريق ليتولاها أحد." },
    nodes: [
      { label: { en: "Customer submits", ar: "العميل يرسل" }, tone: "a" },
      { label: { en: "Team from category", ar: "الفريق من التصنيف" } },
      { label: { en: "Auto-assign (fewest open)", ar: "إسناد تلقائي (الأقل انشغالًا)" } },
      { label: { en: "Else: team queue, Assign to me", ar: "وإلا: قائمة الفريق ثم «إسناد إليّ»" }, tone: "d" },
    ],
  },
  {
    id: "f-sla", area: "sla", audience: [...s],
    title: { en: "SLA clock and escalation", ar: "ساعة اتفاقية الخدمة والتصعيد" },
    summary: { en: "Deadlines run from creation. A warning comes before the deadline and a breach after it. An agent can also escalate by hand.", ar: "تبدأ المواعيد من إنشاء التذكرة. يصل تحذير قبل الموعد وإشعار تجاوز بعده، ويمكن للموظف التصعيد يدويًا." },
    nodes: [
      { label: { en: "Clock starts", ar: "تبدأ الساعة" }, tone: "a" },
      { label: { en: "Due soon (warning)", ar: "يستحق قريبًا (تحذير)" }, tone: "d" },
      { label: { en: "Breached", ar: "متجاوز" }, tone: "d" },
      { label: { en: "Escalated to administrators", ar: "تصعيد إلى المديرين" }, tone: "d" },
    ],
  },
  {
    id: "f-approval", area: "customers", audience: [], perm: "approve_customers",
    title: { en: "New customer approval", ar: "الموافقة على عميل جديد" },
    summary: { en: "The customer registers and verifies by email. Then a person with approval rights chooses their organization and approves.", ar: "يسجّل العميل ويؤكد بريده، ثم يختار صاحب صلاحية الموافقة مؤسسته ويوافق." },
    nodes: [
      { label: { en: "Customer registers", ar: "العميل يسجّل" }, tone: "a" },
      { label: { en: "Email verified", ar: "تأكيد البريد" } },
      { label: { en: "Approve and set organization", ar: "موافقة وتحديد المؤسسة" }, tone: "d" },
      { label: { en: "Customer can sign in", ar: "يمكن للعميل الدخول" }, tone: "o" },
    ],
  },
];
