import type { Article } from "./types";

const c = ["customer"] as const;
const s = ["agent"] as const;

/** Tickets: what a customer does, then what staff do. */
export const TICKET_ARTICLES: Article[] = [
  // ---- Customer ----
  {
    id: "c-my-tickets", kind: "feature", area: "tickets", audience: [...c], path: "/tickets",
    title: { en: "My tickets", ar: "تذاكري" },
    summary: {
      en: "Every request you opened, with its reference, status and last update. Four coloured cards count your tickets: In progress, Waiting for you, Resolved and Closed. Select a card or a filter to narrow the list, or search by reference or subject.",
      ar: "كل الطلبات التي فتحتها مع رقمها المرجعي وحالتها وآخر تحديث. أربع بطاقات ملونة تعدّ تذاكرك: قيد المعالجة، بانتظار ردك، تم الحل، مغلقة. اختر بطاقة أو مرشحًا لتضييق القائمة، أو ابحث بالرقم المرجعي أو الموضوع.",
    },
  },
  {
    id: "c-ticket-page", kind: "feature", area: "tickets", audience: [...c],
    title: { en: "Your ticket page", ar: "صفحة التذكرة" },
    summary: {
      en: "Shows your request, its progress, the conversation with the support team, your attachments and, once solved, the resolution. A status badge always tells you whose turn it is.",
      ar: "تعرض طلبك وتقدّمه والمحادثة مع فريق الدعم ومرفقاتك، وبعد الحل تعرض ملخص الحل. شارة الحالة توضح دائمًا من عليه الدور.",
    },
    tips: [{ en: "\"Waiting for you\" means the team needs your answer before it can continue.", ar: "حالة «بانتظار ردك» تعني أن الفريق يحتاج إجابتك ليواصل العمل." }],
  },
  {
    id: "c-create", kind: "howto", area: "tickets", audience: [...c], path: "/tickets/new",
    title: { en: "Create a ticket", ar: "إنشاء تذكرة" },
    summary: { en: "Ask for help in a few minutes.", ar: "اطلب المساعدة في دقائق." },
    steps: [
      { en: "Select **New ticket** at the top of the page.", ar: "اختر **تذكرة جديدة** من أعلى الصفحة." },
      { en: "Choose a **Category**, and a **Subcategory** if one applies. Articles that may already answer your question appear below.", ar: "اختر **التصنيف**، و**التصنيف الفرعي** إن وُجد. قد تظهر أسفل النموذج مقالات تجيب عن سؤالك." },
      { en: "Choose the **Priority** that matches how urgent this is for you. The team may adjust it after review.", ar: "اختر **الأولوية** بحسب مدى استعجال الأمر. قد يعدّلها الفريق بعد المراجعة." },
      { en: "Write a short **Subject** (3 to 200 characters) and a **Description** of at least 10 characters: what happened, what you expected, and how to reproduce it.", ar: "اكتب **موضوعًا** قصيرًا (من 3 إلى 200 حرف) و**وصفًا** لا يقل عن 10 أحرف: ماذا حدث، وماذا كنت تتوقع، وكيف يمكن إعادة المشكلة." },
      { en: "Attach files if they help: up to 5 files, 10 MB each (PDF, PNG, JPG, DOCX, XLSX or TXT).", ar: "أرفق ملفات إن كانت مفيدة: حتى 5 ملفات، بحجم 10 ميجابايت لكل ملف (PDF أو PNG أو JPG أو DOCX أو XLSX أو TXT)." },
      { en: "Select **Submit ticket**. You get a reference such as CTS-2026-000012 and a confirmation email.", ar: "اختر **إرسال التذكرة**. ستحصل على رقم مرجعي مثل CTS-2026-000012 ورسالة تأكيد بالبريد." },
    ],
    tips: [{ en: "If the ticket is created but a file fails to upload, open the ticket and add the file in a comment.", ar: "إذا أُنشئت التذكرة وتعذّر رفع ملف، افتح التذكرة وأضف الملف في تعليق." }],
    related: ["c-follow", "c-cancel"],
  },
  {
    id: "c-follow", kind: "howto", area: "tickets", audience: [...c], path: "/tickets",
    title: { en: "Follow a ticket and add a comment", ar: "متابعة التذكرة وإضافة تعليق" },
    summary: { en: "Check progress and answer the team.", ar: "تابع التقدم وردّ على الفريق." },
    steps: [
      { en: "Open **My tickets** and select your ticket, or search by its reference.", ar: "افتح **تذاكري** ثم اختر تذكرتك، أو ابحث برقمها المرجعي." },
      { en: "Read the status and the conversation. You also get a bell notification and an email on every reply.", ar: "اقرأ الحالة والمحادثة. يصلك أيضًا إشعار في الجرس ورسالة بريد مع كل رد." },
      { en: "Under **Add a comment**, write your message and select **Send comment**. Attach files if needed.", ar: "ضمن **إضافة تعليق** اكتب رسالتك ثم اختر **إرسال التعليق**. أرفق ملفات عند الحاجة." },
    ],
    tips: [{ en: "You can edit or delete your own comment for 5 minutes after sending it.", ar: "يمكنك تعديل تعليقك أو حذفه خلال 5 دقائق من إرساله." }],
  },
  {
    id: "c-confirm", kind: "howto", area: "tickets", audience: [...c],
    title: { en: "Confirm a solution and rate the service", ar: "تأكيد الحل وتقييم الخدمة" },
    summary: { en: "When the team marks your ticket Resolved.", ar: "عندما يضع الفريق تذكرتك في حالة تم الحل." },
    steps: [
      { en: "Open the resolved ticket and read the **Resolution**.", ar: "افتح التذكرة المحلولة واقرأ **الحل**." },
      { en: "If it worked, select **Confirm and close**. If you do nothing, the ticket closes by itself after a while.", ar: "إذا نجح الحل اختر **تأكيد وإغلاق**. وإن لم تفعل شيئًا تُغلق التذكرة تلقائيًا بعد مدة." },
      { en: "Under **How did we do?** give 1 to 5 stars and an optional comment, then select **Send feedback**. You can update it later.", ar: "ضمن **كيف كان أداؤنا؟** أعطِ من 1 إلى 5 نجوم وتعليقًا اختياريًا ثم اختر **إرسال الملاحظات**. ويمكنك تعديلها لاحقًا." },
    ],
  },
  {
    id: "c-reopen", kind: "howto", area: "tickets", audience: [...c],
    title: { en: "Reopen a ticket", ar: "إعادة فتح تذكرة" },
    summary: { en: "Use this when the problem is not fixed.", ar: "استخدمها إذا لم تُحل المشكلة." },
    steps: [
      { en: "Open the resolved or closed ticket and find **Not fixed?**.", ar: "افتح التذكرة المحلولة أو المغلقة وابحث عن **لم تُحل المشكلة؟**." },
      { en: "Select **Reopen ticket** and explain why in **Why are you reopening?**.", ar: "اختر **إعادة فتح التذكرة** واشرح السبب في **لماذا تعيد الفتح؟**." },
      { en: "Select **Reopen**. The team is notified and the ticket becomes Reopened.", ar: "اختر **إعادة فتح**. يُبلَّغ الفريق وتصبح التذكرة في حالة معاد فتحها." },
    ],
    tips: [{ en: "Reopening is allowed only for a limited period. After it, create a follow-up ticket instead. Tickets closed as duplicate or spam cannot be reopened.", ar: "إعادة الفتح متاحة لمدة محدودة فقط، وبعدها أنشئ تذكرة متابعة. لا يمكن إعادة فتح التذاكر المغلقة كمكررة أو مزعجة." }],
    related: ["c-followup"],
  },
  {
    id: "c-followup", kind: "howto", area: "tickets", audience: [...c],
    title: { en: "Create a follow-up ticket", ar: "إنشاء تذكرة متابعة" },
    summary: { en: "Still need help after a ticket was closed.", ar: "ما زلت بحاجة إلى مساعدة بعد إغلاق التذكرة." },
    steps: [
      { en: "Open the closed ticket.", ar: "افتح التذكرة المغلقة." },
      { en: "Select **Create a follow-up ticket**.", ar: "اختر **إنشاء تذكرة متابعة**." },
      { en: "Complete the form as for any new ticket. The new ticket links back to the old one, so the team sees the history.", ar: "أكمل النموذج كأي تذكرة جديدة. ترتبط التذكرة الجديدة بالقديمة ليرى الفريق السجل." },
    ],
  },
  {
    id: "c-cancel", kind: "howto", area: "tickets", audience: [...c],
    title: { en: "Cancel a ticket", ar: "إلغاء تذكرة" },
    summary: { en: "You no longer need help.", ar: "لم تعد بحاجة إلى المساعدة." },
    steps: [
      { en: "Open the ticket and find **Cancel this ticket**.", ar: "افتح التذكرة وابحث عن **إلغاء هذه التذكرة**." },
      { en: "Select **Cancel ticket** and write why in **Why are you cancelling?**.", ar: "اختر **إلغاء التذكرة** واكتب السبب في **لماذا تلغي؟**." },
      { en: "If nobody has started, it is cancelled at once. If the team already started, you see **Cancellation requested** and the team decides.", ar: "إذا لم يبدأ أحد العمل تُلغى فورًا. وإذا بدأ الفريق تظهر **تم طلب الإلغاء** ويقرر الفريق." },
      { en: "To change your mind, select **Withdraw request** while it is pending.", ar: "للتراجع اختر **سحب الطلب** ما دام معلقًا." },
    ],
  },

  // ---- Staff ----
  {
    id: "s-queue", kind: "feature", area: "tickets", audience: [...s], path: "/console",
    title: { en: "Ticket queue", ar: "قائمة التذاكر" },
    summary: {
      en: "The working list of the tickets your teams are responsible for. Coloured cards count Assigned to me, Unassigned, SLA breached, Due soon and Closed tickets, and each card opens that list. Views: Assigned to me, Unassigned, All visible, Escalated and Closed. Filter by status, priority or SLA, search by reference, subject or customer, and sort any column.",
      ar: "قائمة العمل للتذاكر التي تتولاها فرقك. بطاقات ملونة تعدّ: المسندة إليّ، غير المسندة، تجاوز اتفاقية الخدمة، تستحق قريبًا، والمغلقة، وكل بطاقة تفتح قائمتها. العروض: المسندة إليّ، غير المسندة، كل المرئي، المصعّدة، المغلقة. رشّح بالحالة أو الأولوية أو اتفاقية الخدمة، وابحث بالرقم أو الموضوع أو العميل، ورتّب أي عمود.",
    },
    tips: [
      { en: "The default Status filter is Active, so closed tickets are hidden. Use the green Closed button or card to see them.", ar: "مرشح الحالة الافتراضي هو «نشطة» فتُخفى التذاكر المغلقة. استخدم زر أو بطاقة «مغلقة» الخضراء لعرضها." },
      { en: "The list refreshes by itself. The interval is set by the administrator.", ar: "تتحدث القائمة تلقائيًا، ويحدد المدير الفاصل الزمني." },
    ],
  },
  {
    id: "s-ticket-page", kind: "feature", area: "tickets", audience: [...s],
    title: { en: "Ticket page", ar: "صفحة التذكرة" },
    summary: {
      en: "One page for the whole ticket: customer details, team and assigned agent, SLA clocks, the request, public replies and internal notes, attachments, linked tickets and an activity log. Action panels let you change status, priority, assignment and category, or escalate.",
      ar: "صفحة واحدة للتذكرة كلها: بيانات العميل والفريق والموظف المسؤول، ساعات اتفاقية الخدمة، الطلب، الردود العامة والملاحظات الداخلية، المرفقات، التذاكر المرتبطة وسجل النشاط. لوحات الإجراءات تتيح تغيير الحالة والأولوية والإسناد والتصنيف أو التصعيد.",
    },
  },
  {
    id: "s-reply", kind: "howto", area: "tickets", audience: [...s],
    title: { en: "Reply to a customer or add an internal note", ar: "الرد على عميل أو إضافة ملاحظة داخلية" },
    summary: { en: "Public replies reach the customer. Internal notes never do.", ar: "الردود العامة تصل إلى العميل، أما الملاحظات الداخلية فلا تصله أبدًا." },
    steps: [
      { en: "Open the ticket from the queue.", ar: "افتح التذكرة من القائمة." },
      { en: "In the comment box choose **Public reply** (the customer sees it and is emailed) or **Internal note** (staff only).", ar: "في مربع التعليق اختر **رد عام** (يراه العميل ويصله بريد) أو **ملاحظة داخلية** (للموظفين فقط)." },
      { en: "To reuse an answer, insert a **Saved reply**. Placeholders such as the customer name fill in automatically.", ar: "لإعادة استخدام إجابة أدرج **ردًا محفوظًا**. تُملأ المتغيرات مثل اسم العميل تلقائيًا." },
      { en: "Attach files if needed and send.", ar: "أرفق ملفات عند الحاجة ثم أرسل." },
    ],
    tips: [{ en: "The first public reply (20 characters or more) moves a New or Open ticket to In progress and counts as the first response.", ar: "أول رد عام (20 حرفًا فأكثر) ينقل التذكرة الجديدة أو المفتوحة إلى قيد المعالجة ويُحتسب أول استجابة." }],
    related: ["s-saved"],
  },
  {
    id: "s-status", kind: "howto", area: "tickets", audience: [...s],
    title: { en: "Change the status of a ticket", ar: "تغيير حالة تذكرة" },
    summary: { en: "Move a ticket forward, or park it while you wait.", ar: "انقل التذكرة إلى الأمام أو علّقها أثناء الانتظار." },
    steps: [
      { en: "Open the ticket and find the **Status** panel.", ar: "افتح التذكرة وابحث عن لوحة **الحالة**." },
      { en: "Choose the new status. Only changes allowed from the current status are offered.", ar: "اختر الحالة الجديدة. تُعرض فقط التغييرات المسموحة من الحالة الحالية." },
      { en: "Moving to **Resolved** needs **Resolution details** (shown to the customer). Closing needs a **Closure reason**. Some changes need a **Reason**.", ar: "الانتقال إلى **تم الحل** يتطلب **تفاصيل الحل** (تظهر للعميل). والإغلاق يتطلب **سبب الإغلاق**. وبعض التغييرات تتطلب **سببًا**." },
      { en: "Select **Update status**.", ar: "اختر **تحديث الحالة**." },
    ],
    tips: [{ en: "Pending customer pauses the SLA clock. Pending internal does not, and the customer still sees In progress.", ar: "حالة «بانتظار العميل» توقف ساعة اتفاقية الخدمة، أما «بانتظار جهة داخلية» فلا توقفها ويظل العميل يرى «قيد المعالجة»." }],
  },
  {
    id: "s-assign", kind: "howto", area: "tickets", audience: [...s],
    title: { en: "Assign a ticket", ar: "إسناد تذكرة" },
    summary: { en: "Take a ticket yourself, or hand it to someone.", ar: "تولَّ التذكرة بنفسك أو سلّمها لشخص آخر." },
    steps: [
      { en: "Open the ticket and find the **Assignment** panel.", ar: "افتح التذكرة وابحث عن لوحة **الإسناد**." },
      { en: "Select **Assign to me** to take it.", ar: "اختر **إسناد إليّ** لتتولاها." },
      { en: "Team leaders and administrators can instead pick a **Team** and an **Agent** (or leave Unassigned to return it to the team queue), add an optional reason and select **Assign**.", ar: "يمكن لقادة الفرق والمديرين بدلًا من ذلك اختيار **الفريق** و**الموظف** (أو ترك الخيار غير مسند لإعادتها إلى قائمة الفريق) وإضافة سبب اختياري ثم اختيار **إسناد**." },
    ],
    tips: [{ en: "New tickets can be assigned automatically. See My team.", ar: "يمكن إسناد التذاكر الجديدة تلقائيًا. راجع «فريقي»." }],
  },
  {
    id: "s-priority", kind: "howto", area: "tickets", audience: [...s],
    title: { en: "Change priority or category", ar: "تغيير الأولوية أو التصنيف" },
    summary: { en: "Correct a ticket that was filed under the wrong urgency or topic.", ar: "صحّح تذكرة سُجلت بأولوية أو موضوع غير مناسب." },
    steps: [
      { en: "Open the ticket and use the **Priority** or **Change category** panel.", ar: "افتح التذكرة واستخدم لوحة **الأولوية** أو **تغيير التصنيف**." },
      { en: "Choose the new value and add a reason if you want it recorded.", ar: "اختر القيمة الجديدة وأضف سببًا إن أردت تسجيله." },
      { en: "Select **Set priority** or **Change category**.", ar: "اختر **تعيين الأولوية** أو **تغيير التصنيف**." },
    ],
    tips: [{ en: "Some categories fix the priority, and then it cannot be changed. A closed ticket cannot change category.", ar: "بعض التصنيفات تثبّت الأولوية فلا يمكن تغييرها. ولا يمكن تغيير تصنيف تذكرة مغلقة." }],
  },
  {
    id: "s-escalate", kind: "howto", area: "tickets", audience: [...s],
    title: { en: "Escalate a ticket", ar: "تصعيد تذكرة" },
    summary: { en: "Tell the administrators a ticket needs attention.", ar: "أبلغ المديرين بأن التذكرة تحتاج إلى اهتمام." },
    steps: [
      { en: "Open the ticket and find the **Escalate** panel.", ar: "افتح التذكرة وابحث عن لوحة **التصعيد**." },
      { en: "Write the **Reason**. It is recorded in the activity log.", ar: "اكتب **السبب**، ويُسجَّل في سجل النشاط." },
      { en: "Select **Escalate**. Administrators are notified and the ticket appears under the **Escalated** view.", ar: "اختر **تصعيد**. يُبلَّغ المديرون وتظهر التذكرة ضمن عرض **المصعّدة**." },
    ],
  },
  {
    id: "s-cancel-request", kind: "howto", area: "tickets", audience: [...s],
    title: { en: "Answer a cancellation request", ar: "الرد على طلب إلغاء" },
    summary: { en: "A customer asked to cancel a ticket you already started.", ar: "طلب عميل إلغاء تذكرة بدأت العمل عليها." },
    steps: [
      { en: "Open the ticket. A box titled **Cancellation requested by the customer** shows the reason.", ar: "افتح التذكرة. يعرض صندوق **طلب إلغاء من العميل** السبب." },
      { en: "Write a **Note to the customer** (required if you reject).", ar: "اكتب **ملاحظة للعميل** (مطلوبة عند الرفض)." },
      { en: "Select **Approve and close** or **Reject request**.", ar: "اختر **موافقة وإغلاق** أو **رفض الطلب**." },
    ],
  },
  {
    id: "s-duplicate", kind: "howto", area: "tickets", audience: [...s],
    title: { en: "Close a duplicate or spam ticket", ar: "إغلاق تذكرة مكررة أو مزعجة" },
    summary: { en: "Keep the queue clean without losing the history.", ar: "حافظ على نظافة القائمة دون فقدان السجل." },
    steps: [
      { en: "Open the ticket and find the **Duplicate or spam** panel.", ar: "افتح التذكرة وابحث عن لوحة **مكررة أو مزعجة**." },
      { en: "For a duplicate, type the reference of the original and select **Close as duplicate**. Both tickets show a link to each other.", ar: "للمكررة اكتب الرقم المرجعي للأصلية واختر **إغلاق كمكررة**. تعرض التذكرتان رابطًا لبعضهما." },
      { en: "For spam, select **Mark as spam** and confirm.", ar: "للمزعجة اختر **تحديد كمزعجة** ثم أكّد." },
    ],
    tips: [{ en: "The customer cannot reopen a ticket closed this way, and it is not counted in SLA results.", ar: "لا يستطيع العميل إعادة فتح تذكرة أُغلقت بهذه الطريقة ولا تُحتسب في نتائج اتفاقية الخدمة." }],
  },
  {
    id: "s-new-for-customer", kind: "howto", area: "tickets", audience: [...s], path: "/console/tickets/new",
    title: { en: "Create a ticket for a customer", ar: "إنشاء تذكرة نيابة عن عميل" },
    summary: { en: "For a customer who called or came in person.", ar: "لعميل اتصل هاتفيًا أو حضر شخصيًا." },
    steps: [
      { en: "Select **New ticket for customer** (you need permission to create tickets).", ar: "اختر **تذكرة جديدة لعميل** (يلزمك إذن إنشاء التذاكر)." },
      { en: "Search by name, email, phone or organization, then choose the customer. Only customers inside your access appear.", ar: "ابحث بالاسم أو البريد أو الهاتف أو المؤسسة ثم اختر العميل. تظهر فقط العملاء ضمن نطاق صلاحيتك." },
      { en: "Choose the category, type and priority, then enter the subject and what happened.", ar: "اختر التصنيف والنوع والأولوية ثم اكتب الموضوع وما حدث." },
      { en: "Attach files if needed and select **Create ticket**. The customer is notified like any other ticket.", ar: "أرفق ملفات عند الحاجة واختر **إنشاء تذكرة**. يُبلَّغ العميل كأي تذكرة أخرى." },
    ],
  },
  {
    id: "s-saved", kind: "feature", area: "tickets", audience: [...s], path: "/console/canned",
    title: { en: "Saved replies", ar: "الردود المحفوظة" },
    summary: {
      en: "Write an answer once and insert it into any ticket. Personal replies are visible only to you. Shared replies are visible to all staff. Replies can be set to English, Arabic or any language, and can use placeholders that fill in when inserted.",
      ar: "اكتب إجابة مرة واحدة وأدرجها في أي تذكرة. الردود الشخصية لا يراها غيرك، والمشتركة يراها كل الموظفين. يمكن تحديد اللغة (العربية أو الإنجليزية أو أي لغة) واستخدام متغيرات تُملأ عند الإدراج.",
    },
  },
  {
    id: "s-team", kind: "feature", area: "tickets", audience: [...s], path: "/console/team",
    title: { en: "My team: automatic assignment", ar: "فريقي: الإسناد التلقائي" },
    summary: {
      en: "For team leaders. Switch on the people who should receive new tickets automatically. A new ticket goes to the person with the switch on who has the fewest open tickets and can access that customer's organization. If nobody qualifies it stays in the team queue. A second switch lets a person create tickets for customers.",
      ar: "لقادة الفرق. فعّل المفتاح للأشخاص الذين يستلمون التذاكر الجديدة تلقائيًا. تذهب التذكرة الجديدة إلى صاحب المفتاح المفعّل الأقل تذاكر مفتوحة ممن يمكنه الوصول إلى مؤسسة العميل. وإن لم يتوفر أحد تبقى في قائمة الفريق. ومفتاح ثانٍ يتيح للشخص إنشاء تذاكر للعملاء.",
    },
  },
  {
    id: "s-sla-clock", kind: "feature", area: "tickets", audience: [...s],
    title: { en: "SLA clock on a ticket", ar: "ساعة اتفاقية الخدمة في التذكرة" },
    summary: {
      en: "Each ticket carries two deadlines: first response and resolution. The clock shows On track, Due soon, Breached or Paused. It pauses while the ticket waits for the customer. Every reopen starts a new SLA cycle.",
      ar: "لكل تذكرة موعدان نهائيان: أول رد والحل. تعرض الساعة: في الموعد، يستحق قريبًا، متجاوز، أو متوقف. تتوقف أثناء انتظار العميل، وكل إعادة فتح تبدأ دورة جديدة لاتفاقية الخدمة.",
    },
  },
  {
    id: "s-statuses", kind: "feature", area: "tickets", audience: [...s],
    title: { en: "Ticket statuses", ar: "حالات التذكرة" },
    summary: {
      en: "New: just received. Open: ready or assigned. In progress: an agent is working. Pending customer: waiting for the customer, clock paused. Pending internal: waiting for another team. Resolved: fixed, closes by itself if the customer does not respond. Closed: finished. Reopened: opened again and needs work.",
      ar: "جديدة: وصلت للتو. مفتوحة: جاهزة أو مسندة. قيد المعالجة: موظف يعمل عليها. بانتظار العميل: ننتظر رده والساعة متوقفة. بانتظار جهة داخلية: ننتظر فريقًا آخر. تم الحل: أُصلحت وتُغلق تلقائيًا إن لم يرد العميل. مغلقة: انتهت. معاد فتحها: فُتحت مجددًا وتحتاج عملًا.",
    },
  },
];
