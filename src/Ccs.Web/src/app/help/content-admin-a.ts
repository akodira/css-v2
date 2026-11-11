import type { Article, Flow } from "./types";

/**
 * Administration, part A: SLA and escalation, categories and statuses, people and access.
 * `audience: []` means administrators only. `perm` also opens the guide to staff whose account type has that permission.
 */
export const ADMIN_A_ARTICLES: Article[] = [
  // ---- SLA and escalation ----
  {
    id: "sla-overview", kind: "feature", area: "sla", audience: [], perm: "manage_settings", path: "/admin/sla",
    title: { en: "SLA settings", ar: "إعدادات اتفاقية الخدمة" },
    summary: {
      en: "Response and resolution targets for each priority, working hours, holidays and who is told when a deadline is close or missed. Targets count working minutes only, inside the business calendar that applies to the ticket. Changes apply to new tickets and to tickets whose priority changes. Tickets already open keep their deadlines until you recalculate them.",
      ar: "أهداف الاستجابة والحل لكل أولوية، وساعات العمل والعطلات، ومن يُبلَّغ عند اقتراب الموعد أو تجاوزه. تُحتسب الأهداف بدقائق العمل فقط داخل تقويم العمل المنطبق على التذكرة. تسري التغييرات على التذاكر الجديدة وعلى التذاكر التي تتغير أولويتها، أما المفتوحة فتحتفظ بمواعيدها حتى تعيد حسابها.",
    },
    tips: [{ en: "The default targets are test values. Have the business approve them before relying on them.", ar: "الأهداف الافتراضية قيم تجريبية. اعتمدها مع الجهة المعنية قبل الاعتماد عليها." }],
  },
  {
    id: "sla-targets", kind: "howto", area: "sla", audience: [], perm: "manage_settings", path: "/admin/sla",
    title: { en: "Set SLA targets for a priority", ar: "ضبط أهداف اتفاقية الخدمة لأولوية" },
    summary: { en: "How fast the team must reply and solve.", ar: "السرعة المطلوبة من الفريق في الرد وفي الحل." },
    steps: [
      { en: "Open **SLA settings** and find **Targets by priority**.", ar: "افتح **إعدادات اتفاقية الخدمة** وابحث عن **الأهداف حسب الأولوية**." },
      { en: "Enter **First response** and **Resolution** in working minutes (60 is one hour, 1440 is one day). Resolution includes the first response time.", ar: "أدخل **أول استجابة** و**الحل** بدقائق العمل (60 تعني ساعة، و1440 تعني يومًا). ويشمل الحل زمن أول استجابة." },
      { en: "Set **Warn when this % of the time is used**. For example 80 sends a warning at 80%.", ar: "حدد **نسبة الوقت المستهلك للتحذير**. مثلًا 80 ترسل تحذيرًا عند 80%." },
      { en: "Tick whether the clock pauses while waiting for the customer or for another team.", ar: "حدد هل تتوقف الساعة أثناء انتظار العميل أو فريق آخر." },
      { en: "Under **On warning, tell** and **On breach, tell**, choose from Assigned agent, Team leader and Admins.", ar: "ضمن **عند التحذير أبلغ** و**عند التجاوز أبلغ** اختر من: الموظف المسؤول، قائد الفريق، المديرون." },
      { en: "Select **Save**.", ar: "اختر **حفظ**." },
    ],
    tips: [{ en: "The same targets also appear on each priority under Priorities.", ar: "تظهر الأهداف نفسها لكل أولوية ضمن صفحة الأولويات." }],
    related: ["sla-calendar", "pri-edit"],
  },
  {
    id: "sla-calendar", kind: "howto", area: "sla", audience: [], perm: "manage_settings", path: "/admin/sla",
    title: { en: "Set up working hours, holidays and calendars", ar: "إعداد ساعات العمل والعطلات والتقاويم" },
    summary: { en: "A calendar holds the working days, hours, time zone and holidays of one country or site.", ar: "يضم التقويم أيام العمل وساعاتها والمنطقة الزمنية والعطلات لدولة أو موقع واحد." },
    steps: [
      { en: "Under **Business calendars** enter a **New calendar name** and its **Time zone** (for example Africa/Cairo), then select **Add calendar**.", ar: "ضمن **تقاويم العمل** أدخل **اسم التقويم** و**المنطقة الزمنية** (مثل Africa/Cairo) ثم اختر **إضافة تقويم**." },
      { en: "Open the calendar. For each day tick **Open** and set **From** and **To**.", ar: "افتح التقويم. لكل يوم حدد **مفتوح** و**من** و**إلى**." },
      { en: "Add each public holiday with its **Date** and **Name**, then select **Add holiday**.", ar: "أضف كل عطلة رسمية بـ**تاريخها** و**اسمها** ثم اختر **إضافة عطلة**." },
      { en: "Choose the **Default calendar for SLA targets**.", ar: "اختر **التقويم الافتراضي لأهداف اتفاقية الخدمة**." },
      { en: "After changing hours or holidays, select **Recalculate open tickets** so existing tickets use the new calendar. This is recorded in the audit log.", ar: "بعد تغيير الساعات أو العطلات اختر **إعادة حساب التذاكر المفتوحة** لتستخدم التذاكر القائمة التقويم الجديد. ويُسجَّل ذلك في سجل التدقيق." },
    ],
    tips: [{ en: "A ticket follows the calendar of the customer's branch, then their organization, then the team handling it, then the default. Use **Which calendar applies** to link a calendar to a branch, organization or team.", ar: "تتبع التذكرة تقويم فرع العميل ثم مؤسسته ثم الفريق المعالج ثم الافتراضي. استخدم **أي تقويم ينطبق** لربط تقويم بفرع أو مؤسسة أو فريق." }],
  },
  {
    id: "esc-overview", kind: "feature", area: "sla", audience: [], path: "/admin/escalation",
    title: { en: "Escalation rules", ar: "قواعد التصعيد" },
    summary: {
      en: "Decide, for each organization and branch, which leaders an agent can send a ticket to. Leaders come from the organization tree: the branch leader first, then each organization leader up to the top. Three settings: Any leader above (a dropdown of all of them, nearest first), Next leader only, and Escalation off. A branch setting overrides its organization.",
      ar: "حدد لكل مؤسسة وفرع القادة الذين يمكن للموظف إحالة التذكرة إليهم. يأتي القادة من شجرة المؤسسات: قائد الفرع أولًا ثم قائد كل مؤسسة صعودًا. ثلاثة إعدادات: أي قائد أعلى (قائمة بكلهم الأقرب أولًا)، القائد التالي فقط، وإيقاف التصعيد. وإعداد الفرع يتقدم على إعداد مؤسسته.",
    },
  },
  {
    id: "esc-set", kind: "howto", area: "sla", audience: [], path: "/admin/escalation",
    title: { en: "Change who can escalate to whom", ar: "تغيير من يمكنه التصعيد ولمن" },
    summary: { en: "Apply one setting to several organizations or branches at once.", ar: "طبّق إعدادًا واحدًا على عدة مؤسسات أو فروع دفعة واحدة." },
    steps: [
      { en: "Open **Escalation**. Tick the organizations and/or branches to change. Open **N branches** to see an organization's branches.", ar: "افتح **التصعيد**. حدد المؤسسات و/أو الفروع المطلوبة، وافتح **عدد الفروع** لرؤية فروع المؤسسة." },
      { en: "Choose **Any leader above**, **Next leader only**, or **Escalation off**. For a branch you can also choose **Same as organization** to remove its own setting.", ar: "اختر **أي قائد أعلى** أو **القائد التالي فقط** أو **إيقاف التصعيد**. وللفرع يمكنك أيضًا اختيار **مثل المؤسسة** لإزالة إعداده الخاص." },
      { en: "Select **Apply**.", ar: "اختر **تطبيق**." },
    ],
    tips: [
      { en: "Ticking an organization does not tick its branches. To make one branch different, tick only that branch.", ar: "تحديد المؤسسة لا يحدد فروعها. لجعل فرع واحد مختلفًا حدده وحده." },
      { en: "A reason is always required when escalating. The ticket moves to the chosen leader, who is emailed the reason, and the escalation is saved in the audit log.", ar: "السبب مطلوب دائمًا عند التصعيد. تنتقل التذكرة إلى القائد المختار ويصله بريد بالسبب، ويُحفظ التصعيد في سجل التدقيق." },
    ],
  },

  // ---- Categories and statuses ----
  {
    id: "cat-overview", kind: "feature", area: "catalog", audience: [], perm: "manage_catalog", path: "/admin/catalog",
    title: { en: "Categories, ticket types and custom fields", ar: "التصنيفات وأنواع التذاكر والحقول المخصصة" },
    summary: {
      en: "Categories and subcategories are what customers choose when they open a ticket. Each can have a default team, automatic assignment, a fixed priority, or be private (staff only). Ticket types are picked first and decide which categories the customer sees. Custom fields add extra questions to the ticket form.",
      ar: "التصنيفات والتصنيفات الفرعية هي ما يختاره العميل عند فتح تذكرة. ولكل منها فريق افتراضي وإسناد تلقائي وأولوية ثابتة، أو يمكن جعله خاصًا (للموظفين فقط). يُختار نوع التذكرة أولًا ويحدد التصنيفات التي يراها العميل. وتضيف الحقول المخصصة أسئلة إضافية إلى نموذج التذكرة.",
    },
  },
  {
    id: "cat-add", kind: "howto", area: "catalog", audience: [], perm: "manage_catalog", path: "/admin/catalog",
    title: { en: "Add a category or subcategory", ar: "إضافة تصنيف أو تصنيف فرعي" },
    summary: { en: "Decide where new tickets go and how urgent they are.", ar: "حدد وجهة التذاكر الجديدة ودرجة استعجالها." },
    steps: [
      { en: "Open **Categories** and select **Add category**.", ar: "افتح **التصنيفات** واختر **إضافة تصنيف**." },
      { en: "Enter the **Name** in English and Arabic and a **Sort order**.", ar: "أدخل **الاسم** بالإنجليزية والعربية و**ترتيب العرض**." },
      { en: "Choose the **Default team**. Switch **Auto-assign** on to send new tickets to the team member with the fewest open tickets, or off to leave them in the team queue.", ar: "اختر **الفريق الافتراضي**. فعّل **الإسناد التلقائي** لإرسال التذاكر الجديدة إلى عضو الفريق الأقل تذاكر مفتوحة، أو أوقفه لتبقى في قائمة الفريق." },
      { en: "Optionally set a **Fixed priority** (staff cannot change it) or tick **Private category (staff only)**.", ar: "اختياريًا حدد **أولوية ثابتة** (لا يستطيع الموظفون تغييرها) أو **تصنيف خاص (للموظفين فقط)**." },
      { en: "Select **Add Category**. To add a subcategory, select **Add Sub-Category** and choose the category it belongs to. A subcategory's fixed priority overrides its category's.", ar: "اختر **إضافة تصنيف**. ولإضافة تصنيف فرعي اختر **إضافة تصنيف فرعي** وحدد التصنيف الذي يتبعه. وأولوية التصنيف الفرعي الثابتة تتقدم على أولوية تصنيفه." },
    ],
    tips: [{ en: "Use the arrows to reorder. Deactivate instead of deleting when a category already has tickets.", ar: "استخدم الأسهم لإعادة الترتيب. أوقف التصنيف بدلًا من حذفه إذا كانت له تذاكر." }],
  },
  {
    id: "cat-types", kind: "howto", area: "catalog", audience: [], perm: "manage_catalog", path: "/admin/catalog",
    title: { en: "Control which categories each ticket type shows", ar: "التحكم في التصنيفات التي يعرضها كل نوع تذكرة" },
    summary: { en: "Customers pick a type first, then see only its categories.", ar: "يختار العميل النوع أولًا ثم يرى تصنيفاته فقط." },
    steps: [
      { en: "In **Categories**, open the ticket types section.", ar: "في **التصنيفات** افتح قسم أنواع التذاكر." },
      { en: "Tick **Show to customers on the new ticket form** for each type you want customers to choose.", ar: "حدد **إظهار للعملاء في نموذج التذكرة الجديدة** لكل نوع تريد أن يختاره العملاء." },
      { en: "In **Which categories each type shows**, tick a box to let customers choose that category after picking that type. A category can belong to many types.", ar: "في **التصنيفات التي يعرضها كل نوع** حدد مربعًا للسماح باختيار ذلك التصنيف بعد اختيار النوع. ويمكن أن يتبع التصنيف أنواعًا عدة." },
    ],
    tips: [{ en: "A category linked to no type is shown in red and customers cannot choose it. Hiding a type removes it from the new ticket form only. At least one type must stay visible.", ar: "التصنيف غير المرتبط بنوع يظهر بالأحمر ولا يستطيع العملاء اختياره. وإخفاء النوع يزيله من نموذج التذكرة الجديدة فقط. ويجب أن يبقى نوع واحد ظاهرًا على الأقل." }],
  },
  {
    id: "cat-field", kind: "howto", area: "catalog", audience: [], perm: "manage_catalog", path: "/admin/catalog",
    title: { en: "Add a custom field to the ticket form", ar: "إضافة حقل مخصص إلى نموذج التذكرة" },
    summary: { en: "Collect extra details such as an asset number.", ar: "اجمع تفاصيل إضافية مثل رقم الجهاز." },
    steps: [
      { en: "Open the **Custom fields** section and select **Add field**.", ar: "افتح قسم **الحقول المخصصة** واختر **إضافة حقل**." },
      { en: "Enter the **Key** (it cannot change later), the names in English and Arabic, and the **Type** (text, number, dropdown, multi-select, radio and so on).", ar: "أدخل **المفتاح** (لا يمكن تغييره لاحقًا) والاسمين بالإنجليزية والعربية و**النوع** (نص أو رقم أو قائمة منسدلة أو متعدد الاختيار أو اختيار واحد وغيرها)." },
      { en: "Choose **Applies to**: all categories or one.", ar: "اختر **ينطبق على**: كل التصنيفات أو تصنيف واحد." },
      { en: "For choice types, write **Options**, one per line: value | English label | Arabic label (the Arabic label is optional).", ar: "لأنواع الاختيار اكتب **الخيارات** كل خيار في سطر: القيمة | العنوان الإنجليزي | العنوان العربي (والعربي اختياري)." },
      { en: "Set validation rules (minimum, maximum, length or a pattern) and tick **Required** if the customer must answer.", ar: "حدد قواعد التحقق (الحد الأدنى أو الأقصى أو الطول أو نمط) وحدد **مطلوب** إذا كان على العميل الإجابة." },
      { en: "Tick **Shown to the customer**, or leave it off for a staff-only field that the support team fills in on the ticket. Select **Add field**.", ar: "حدد **يظهر للعميل**، أو اتركه دون تحديد لحقل للموظفين فقط يملؤه فريق الدعم داخل التذكرة. ثم اختر **إضافة حقل**." },
    ],
  },
  {
    id: "pri-overview", kind: "feature", area: "catalog", audience: [], perm: "manage_catalog", path: "/admin/priorities",
    title: { en: "Priorities", ar: "الأولويات" },
    summary: {
      en: "The priorities used on tickets. Each has a name in both languages, a colour, an order and its own SLA targets. Normal is the default and can be renamed but not deleted or deactivated. Choose how a new ticket gets its priority: from the system (the category sets it, otherwise Normal) or chosen by the customer (and by staff when they create a ticket for a customer).",
      ar: "الأولويات المستخدمة في التذاكر. لكل أولوية اسم بالعربية والإنجليزية ولون وترتيب وأهداف خدمة خاصة بها. «عادية» هي الافتراضية ويمكن إعادة تسميتها لكن لا يمكن حذفها أو إيقافها. اختر كيف تحصل التذكرة الجديدة على أولويتها: من النظام (يحددها التصنيف وإلا عادية) أو يختارها العميل (ويختارها الموظف عند إنشاء تذكرة لعميل).",
    },
  },
  {
    id: "pri-edit", kind: "howto", area: "catalog", audience: [], perm: "manage_catalog", path: "/admin/priorities",
    title: { en: "Add or edit a priority", ar: "إضافة أولوية أو تعديلها" },
    summary: { en: "Name, colour, order and targets in one place.", ar: "الاسم واللون والترتيب والأهداف في مكان واحد." },
    steps: [
      { en: "Open **Priorities** and select a priority to edit, or add a new one.", ar: "افتح **الأولويات** واختر أولوية للتعديل أو أضف أولوية جديدة." },
      { en: "Enter the names in English and Arabic, pick a colour and set the order.", ar: "أدخل الاسمين بالإنجليزية والعربية واختر اللون وحدد الترتيب." },
      { en: "Set the **First response target** and **Resolution target** in minutes (60 is one hour, 1440 is one day).", ar: "حدد **هدف أول استجابة** و**هدف الحل** بالدقائق (60 ساعة، و1440 يوم)." },
      { en: "Save. The page also shows how many categories use each priority.", ar: "احفظ. وتعرض الصفحة أيضًا عدد التصنيفات التي تستخدم كل أولوية." },
    ],
    tips: [{ en: "To choose who sets the priority, use the mode switch at the top of the page.", ar: "لاختيار من يحدد الأولوية استخدم مفتاح الوضع في أعلى الصفحة." }],
  },
  {
    id: "status-overview", kind: "feature", area: "catalog", audience: [], perm: "manage_settings", path: "/admin/ticket-status",
    title: { en: "Ticket status and the lifecycle guide", ar: "حالة التذكرة ودليل دورة الحياة" },
    summary: {
      en: "Every ticket is always in one of eight statuses. You can rename them, change their colour and description, choose what customers see, and decide who may move a ticket from one status to another. What a status does cannot be removed: Pending customer always pauses the service clock and Resolved always needs a resolution summary. A separate guide explains every status, timer, reason and SLA rule in plain language.",
      ar: "تكون كل تذكرة دائمًا في إحدى ثماني حالات. يمكنك إعادة تسميتها وتغيير لونها ووصفها، وتحديد ما يراه العميل، وتحديد من يستطيع نقل التذكرة من حالة إلى أخرى. أما وظيفة الحالة نفسها فلا تُزال: «بانتظار العميل» توقف دائمًا ساعة الخدمة، و«تم الحل» تتطلب دائمًا ملخص حل. ويشرح دليل مستقل كل حالة ومؤقت وسبب وقاعدة لاتفاقية الخدمة بلغة مبسطة.",
    },
  },
  {
    id: "status-guide", kind: "feature", area: "catalog", audience: [], perm: "manage_settings", path: "/admin/ticket-status/guide",
    title: { en: "Ticket lifecycle guide", ar: "دليل دورة حياة التذكرة" },
    summary: {
      en: "A plain-language guide for administrators and team leaders: every status, timer, closure reason and SLA rule, how a ticket moves from New to Closed, how to change that, and how the service clocks and calendars work. Open it from the Ticket status page when you are not sure what a setting does.",
      ar: "دليل مبسط للمديرين وقادة الفرق: كل حالة ومؤقت وسبب إغلاق وقاعدة لاتفاقية الخدمة، وكيف تنتقل التذكرة من جديدة إلى مغلقة، وكيف تغيّر ذلك، وكيف تعمل ساعات الخدمة والتقاويم. افتحه من صفحة حالة التذكرة عندما لا تعرف ما يفعله إعداد ما.",
    },
  },
  {
    id: "status-edit", kind: "howto", area: "catalog", audience: [], perm: "manage_settings", path: "/admin/ticket-status",
    title: { en: "Rename a status and change the allowed moves", ar: "إعادة تسمية حالة وتغيير الانتقالات المسموحة" },
    summary: { en: "Adapt the ticket flow to how your team works.", ar: "كيّف مسار التذكرة مع طريقة عمل فريقك." },
    steps: [
      { en: "Open **Ticket status** and select a status under **Statuses**.", ar: "افتح **حالة التذكرة** واختر حالة ضمن **الحالات**." },
      { en: "Change its **Name for customers**, **Colour** (Blue, Amber, Green, Red or Grey) and description.", ar: "غيّر **الاسم الظاهر للعملاء** و**اللون** (أزرق أو كهرماني أو أخضر أو أحمر أو رمادي) والوصف." },
      { en: "In **Flow**, tick the statuses staff may move a ticket to from here. The **Your flow** diagram updates as you tick: blue arrows are staff moves, dashed arrows are customer moves.", ar: "في **المسار** حدد الحالات التي يمكن للموظفين نقل التذكرة إليها من هذه الحالة. يتحدث مخطط **مسارك** أثناء التحديد: الأسهم الزرقاء انتقالات الموظفين والمتقطعة انتقالات العميل." },
      { en: "Fix any problems listed under **Fix these before saving** (for example a status nobody can reach), then save.", ar: "عالج أي مشكلات تحت **عالج هذه قبل الحفظ** (مثل حالة لا يمكن لأحد الوصول إليها) ثم احفظ." },
    ],
    tips: [
      { en: "**Back to standard flow** restores the original moves. Moving to Resolved needs the Resolve permission and to Closed needs the Close permission. Every change is written to the audit log.", ar: "**العودة إلى المسار القياسي** تعيد الانتقالات الأصلية. الانتقال إلى «تم الحل» يتطلب صلاحية الحل وإلى «مغلقة» صلاحية الإغلاق. وتُكتب كل التغييرات في سجل التدقيق." },
      { en: "Some moves happen by themselves, such as closing a resolved ticket after the waiting period. They cannot be switched off here.", ar: "بعض الانتقالات تحدث تلقائيًا مثل إغلاق تذكرة محلولة بعد مدة الانتظار، ولا يمكن إيقافها من هنا." },
    ],
    related: ["status-reason"],
  },
  {
    id: "status-reason", kind: "howto", area: "catalog", audience: [], perm: "manage_settings", path: "/admin/ticket-status",
    title: { en: "Add a closure reason", ar: "إضافة سبب إغلاق" },
    summary: { en: "Record why a ticket was closed, apart from its status.", ar: "سجّل سبب إغلاق التذكرة بمعزل عن حالتها." },
    steps: [
      { en: "Open **Ticket status** and find **Closure reasons**.", ar: "افتح **حالة التذكرة** وابحث عن **أسباب الإغلاق**." },
      { en: "Select **Add a reason**, enter the name in English and Arabic.", ar: "اختر **إضافة سبب** وأدخل الاسم بالإنجليزية والعربية." },
      { en: "Select **Save reason**.", ar: "اختر **حفظ السبب**." },
    ],
    tips: [{ en: "The built-in reasons are needed by the automatic rules (for example No customer response, Cancelled, Duplicate, Spam) and cannot be deleted.", ar: "الأسباب المدمجة تحتاجها القواعد التلقائية (مثل عدم رد العميل والإلغاء والتكرار والإزعاج) ولا يمكن حذفها." }],
  },

  // ---- People and access ----
  {
    id: "roles-guide", kind: "feature", area: "people", audience: [], path: "/admin/users",
    title: { en: "Roles at a glance", ar: "الأدوار باختصار" },
    summary: {
      en: "Customer: asks for help and follows their own requests. Agent: works tickets and answers customers. Team leader: an agent who also directs the team and assigns tickets. Administrator: runs the whole system. Management viewer: watches dashboards, reports and tickets without changing anything. Organization admin and Branch admin: an agent who also manages the people, approvals and tickets of only the organizations or branches chosen for them. A customer role cannot be combined with staff roles. What a person can finally do is decided by their account type under Permissions.",
      ar: "العميل: يطلب المساعدة ويتابع طلباته. الموظف: يعالج التذاكر ويجيب العملاء. قائد الفريق: موظف يوجّه الفريق ويسند التذاكر أيضًا. المدير: يدير النظام كله. المشاهد الإداري: يطّلع على اللوحات والتقارير والتذاكر دون تغيير شيء. مدير المؤسسة ومدير الفرع: موظف يدير أيضًا الأشخاص والموافقات والتذاكر في المؤسسات أو الفروع المختارة له فقط. ولا يمكن الجمع بين دور العميل وأدوار الموظفين. وما يستطيع الشخص فعله فعليًا تحدده نوع حسابه ضمن الصلاحيات.",
    },
  },
  {
    id: "users-overview", kind: "feature", area: "people", audience: [], path: "/admin/users",
    title: { en: "Staff", ar: "الموظفون" },
    summary: {
      en: "Agents, team leaders, administrators and management viewers. Search, add, edit, suspend and reactivate them. A person with tickets, messages or other history cannot be deleted: suspend the account instead. Customers are managed under Customers.",
      ar: "الموظفون وقادة الفرق والمديرون والمشاهدون الإداريون. ابحث وأضف وعدّل وأوقف وأعد التفعيل. لا يمكن حذف شخص لديه تذاكر أو رسائل أو سجل آخر، أوقف حسابه بدلًا من ذلك. وتُدار حسابات العملاء ضمن «العملاء».",
    },
  },
  {
    id: "users-add", kind: "howto", area: "people", audience: [], path: "/admin/users",
    title: { en: "Add a staff member", ar: "إضافة موظف" },
    summary: { en: "Create the account and give a first password.", ar: "أنشئ الحساب وأعطِ كلمة مرور أولى." },
    steps: [
      { en: "Open **People › Staff** and select **Add staff**.", ar: "افتح **الأشخاص › الموظفون** واختر **إضافة موظف**." },
      { en: "Enter the full name, email and phone number.", ar: "أدخل الاسم الكامل والبريد الإلكتروني ورقم الهاتف." },
      { en: "Select **Generate** for a **Temporary password**, or type one that meets the password policy.", ar: "اختر **توليد** لـ**كلمة مرور مؤقتة**، أو اكتب كلمة تحقق سياسة كلمات المرور." },
      { en: "Choose the **Roles**. Each card lists everything that role can do. For a person who should manage only part of the company, choose **Organization admin** or **Branch admin** instead (see the next guide).", ar: "اختر **الأدوار**. تعرض كل بطاقة كل ما يستطيعه الدور. وللشخص الذي يجب أن يدير جزءًا من الشركة فقط اختر **مدير المؤسسة** أو **مدير الفرع** (انظر الدليل التالي)." },
      { en: "Select **Create**. Copy the temporary password now: it is shown only once. Give it to the person, who can change it under My account.", ar: "اختر **إنشاء**. انسخ كلمة المرور المؤقتة الآن فهي تظهر مرة واحدة فقط. سلّمها للشخص ويمكنه تغييرها من حسابي." },
    ],
    tips: [{ en: "Then give the person an account type under Permissions, and add them to a team under Teams.", ar: "بعد ذلك امنح الشخص نوع حساب ضمن الصلاحيات، وأضفه إلى فريق ضمن الفرق." }],
    related: ["users-scoped-admin", "perm-type", "teams-members"],
  },
  {
    id: "users-scoped-admin", kind: "howto", area: "people", audience: [], path: "/admin/users",
    title: { en: "Add an Organization admin or a Branch admin", ar: "إضافة مدير مؤسسة أو مدير فرع" },
    summary: { en: "One step: the person, their account type and the organizations or branches they manage.", ar: "خطوة واحدة: الشخص ونوع حسابه والمؤسسات أو الفروع التي يديرها." },
    steps: [
      { en: "Open **People › Staff** and select **Add staff**. Enter the name, email, phone and a **Temporary password**.", ar: "افتح **الأشخاص › الموظفون** واختر **إضافة موظف**. أدخل الاسم والبريد والهاتف و**كلمة مرور مؤقتة**." },
      { en: "Tick **Organization admin** (to manage whole organizations and the ones inside them) or **Branch admin** (to manage chosen branches). These two cards cannot be combined with other roles.", ar: "حدد **مدير المؤسسة** (لإدارة مؤسسات كاملة والمؤسسات التابعة لها) أو **مدير الفرع** (لإدارة فروع مختارة). لا يمكن الجمع بين هاتين البطاقتين وأي دور آخر." },
      { en: "A list opens under the cards. Search, then tick the organizations or branches. For branches, **Select all** takes a whole organization. Your choices appear as chips you can remove.", ar: "تظهر قائمة تحت البطاقات. ابحث ثم حدد المؤسسات أو الفروع. وفي الفروع يختار **تحديد الكل** مؤسسة كاملة. وتظهر اختياراتك على شكل شارات يمكن إزالتها." },
      { en: "Select **Create**. At least one organization or branch is required. The account is created as an agent with the matching account type and scope in one step.", ar: "اختر **إنشاء**. يلزم اختيار مؤسسة أو فرع واحد على الأقل. يُنشأ الحساب كموظف بنوع الحساب والنطاق المناسبين في خطوة واحدة." },
    ],
    tips: [
      { en: "What these admins can do is decided by their account type under **People › Permissions**. You can change it there at any time, and change the chosen organizations or branches from the person\u2019s row in Staff.", ar: "ما يستطيعه هؤلاء المديرون يحدده نوع حسابهم ضمن **الأشخاص › الصلاحيات**، ويمكنك تغييره في أي وقت، وتغيير المؤسسات أو الفروع المختارة من صف الشخص في «الموظفون»." },
    ],
    related: ["users-add", "perm-type", "s-people"],
  },
  {
    id: "users-promote", kind: "howto", area: "people", audience: [], path: "/admin/customers",
    title: { en: "Turn a customer into a staff member, or back", ar: "تحويل عميل إلى موظف أو العكس" },
    summary: { en: "Their tickets and history are kept.", ar: "تُحفظ تذاكره وسجله." },
    steps: [
      { en: "Open **Customers** and select the person.", ar: "افتح **العملاء** واختر الشخص." },
      { en: "Choose a staff role. One role at a time: the customer role is replaced.", ar: "اختر دور موظف. دور واحد في كل مرة، ويحل محل دور العميل." },
      { en: "Fill in the details asked (for example the organizations and branches they manage and whether tickets are assigned to them automatically) and confirm. The person is emailed.", ar: "أكمل التفاصيل المطلوبة (مثل المؤسسات والفروع التي يديرها وهل تُسند إليه التذاكر تلقائيًا) ثم أكّد. يصل الشخص بريد." },
      { en: "To reverse it, open the person and select **Yes, turn back into a customer**. Team membership and open ticket assignments are removed. Tickets and history stay.", ar: "للتراجع افتح الشخص واختر **نعم، أعده عميلًا**. تُزال عضويته في الفرق وإسناد التذاكر المفتوحة، وتبقى التذاكر والسجل." },
    ],
  },
  {
    id: "customers-admin", kind: "feature", area: "customers", audience: [], path: "/admin/customers",
    title: { en: "Customers (administration)", ar: "العملاء (الإدارة)" },
    summary: {
      en: "All customers with organization, branch, status and ticket counts. Add a customer, edit details, change organization and branch, approve or reject new sign-ups, suspend or reactivate. A customer with tickets cannot be deleted: suspend the account. Statuses: Active, Suspended, Waiting for email verification and Waiting for administrator approval.",
      ar: "كل العملاء مع المؤسسة والفرع والحالة وعدد التذاكر. أضف عميلًا وعدّل بياناته وغيّر مؤسسته وفرعه ووافق على التسجيلات الجديدة أو ارفضها وأوقف الحساب أو أعد تفعيله. لا يمكن حذف عميل لديه تذاكر، أوقف حسابه. الحالات: نشط، موقوف، بانتظار تأكيد البريد، بانتظار موافقة المدير.",
    },
  },
  {
    id: "customers-add", kind: "howto", area: "customers", audience: [], path: "/admin/customers",
    title: { en: "Add a customer yourself", ar: "إضافة عميل يدويًا" },
    summary: { en: "Useful when registration is closed or for a customer who cannot register.", ar: "مفيدة عند إغلاق التسجيل أو لعميل لا يستطيع التسجيل." },
    steps: [
      { en: "Open **Customers** and select **Add customer**.", ar: "افتح **العملاء** واختر **إضافة عميل**." },
      { en: "Enter name, email and phone, and choose the **Organization** and **Branch**.", ar: "أدخل الاسم والبريد والهاتف واختر **المؤسسة** و**الفرع**." },
      { en: "Select **Generate** for a temporary password, then **Create**. Copy the password: it is shown only once.", ar: "اختر **توليد** لكلمة مرور مؤقتة ثم **إنشاء**. انسخ كلمة المرور فهي تظهر مرة واحدة." },
    ],
  },
  {
    id: "teams-overview", kind: "feature", area: "people", audience: [], path: "/admin/teams",
    title: { en: "Teams", ar: "الفرق" },
    summary: {
      en: "A team is a group of agents who share a queue. Categories send tickets to a default team. Members must already have the Agent or Team leader role. A team with tickets, or used as a category default, cannot be deleted: deactivate it.",
      ar: "الفريق مجموعة موظفين يتشاركون قائمة واحدة. ترسل التصنيفات التذاكر إلى فريق افتراضي. يجب أن يكون الأعضاء حاصلين مسبقًا على دور موظف أو قائد فريق. ولا يمكن حذف فريق لديه تذاكر أو مستخدم كافتراضي لتصنيف، أوقفه بدلًا من ذلك.",
    },
  },
  {
    id: "teams-members", kind: "howto", area: "people", audience: [], path: "/admin/teams",
    title: { en: "Create a team and add members", ar: "إنشاء فريق وإضافة أعضاء" },
    summary: { en: "Teams are where tickets wait and who works them.", ar: "الفرق هي مكان انتظار التذاكر ومن يعمل عليها." },
    steps: [
      { en: "Open **Teams** and select **Add a team**. Enter the name in English and Arabic and, if you want, an **Assigned team leader**.", ar: "افتح **الفرق** واختر **إضافة فريق**. أدخل الاسم بالإنجليزية والعربية و، إن أردت، **قائد الفريق المعيّن**." },
      { en: "Open the team and select **Add member**. Under **Select a person** choose an agent or team leader.", ar: "افتح الفريق واختر **إضافة عضو**. ضمن **اختيار شخص** اختر موظفًا أو قائد فريق." },
      { en: "Tick **Team leader of this team** if they lead it, then select **Add**.", ar: "حدد **قائد هذا الفريق** إن كان يقوده ثم اختر **إضافة**." },
      { en: "To remove someone select **Remove** next to their name.", ar: "لإزالة شخص اختر **إزالة** بجانب اسمه." },
    ],
    tips: [{ en: "Team leaders can switch automatic assignment on or off for their people under My team.", ar: "يمكن لقادة الفرق تفعيل الإسناد التلقائي لأفرادهم أو إيقافه من صفحة فريقي." }],
  },
  {
    id: "orgs-overview", kind: "feature", area: "people", audience: [], path: "/admin/organizations",
    title: { en: "Organizations and branches", ar: "المؤسسات والفروع" },
    summary: {
      en: "Each organization has a location, a telephone and an assigned team leader, and can have branches with the same details. Organizations form a tree, so an organization includes the organizations below it. Customers belong to an organization and a branch. An organization with customers or branches cannot be deleted: deactivate it.",
      ar: "لكل مؤسسة موقع وهاتف وقائد فريق معيّن، ويمكن أن تضم فروعًا بالبيانات نفسها. تشكل المؤسسات شجرة فتشمل المؤسسة ما تحتها. ينتمي العملاء إلى مؤسسة وفرع. ولا يمكن حذف مؤسسة لديها عملاء أو فروع، أوقفها بدلًا من ذلك.",
    },
  },
  {
    id: "orgs-add", kind: "howto", area: "people", audience: [], path: "/admin/organizations",
    title: { en: "Add an organization and its branches", ar: "إضافة مؤسسة وفروعها" },
    summary: { en: "Set up where your customers belong.", ar: "جهّز المكان الذي ينتمي إليه عملاؤك." },
    steps: [
      { en: "Open **Organizations** and select **Add an organization**.", ar: "افتح **المؤسسات** واختر **إضافة مؤسسة**." },
      { en: "Enter the organization name in English and Arabic, its location, telephone, and the **Assigned team leader**.", ar: "أدخل اسم المؤسسة بالإنجليزية والعربية وموقعها وهاتفها و**قائد الفريق المعيّن**." },
      { en: "Select **Create**. Then open it and select **Add a branch** to add branches with the same details.", ar: "اختر **إنشاء**. ثم افتحها واختر **إضافة فرع** لإضافة فروع بالبيانات نفسها." },
    ],
    tips: [{ en: "The team leader you assign here is the leader that appears in the escalation list. Give someone the Team leader role under Staff first.", ar: "قائد الفريق الذي تعيّنه هنا هو القائد الذي يظهر في قائمة التصعيد. امنح شخصًا دور قائد فريق من الموظفين أولًا." }],
    related: ["esc-set"],
  },
  {
    id: "perm-overview", kind: "feature", area: "people", audience: [], path: "/admin/permissions",
    title: { en: "Permissions and account types", ar: "الصلاحيات وأنواع الحسابات" },
    summary: {
      en: "An account type is a named set of permissions plus the organizations and branches it can access. Each staff member gets one type. Changing a type changes everyone who has it. Administrator is built in: it has every permission everywhere, now and in the future, and cannot be changed or deleted. You cannot change your own type, and the last administrator cannot be changed.",
      ar: "نوع الحساب مجموعة مسماة من الصلاحيات مع المؤسسات والفروع التي يمكنه الوصول إليها. يحصل كل موظف على نوع واحد، وتغيير النوع يغيّر كل من يحمله. المدير نوع مدمج له كل الصلاحيات في كل مكان الآن ومستقبلًا ولا يمكن تغييره أو حذفه. ولا يمكنك تغيير نوع حسابك، ولا يمكن تغيير آخر مدير.",
    },
  },
  {
    id: "perm-list", kind: "feature", area: "people", audience: [], path: "/admin/permissions",
    title: { en: "What each permission allows", ar: "ما تتيحه كل صلاحية" },
    summary: {
      en: "Tickets: reply, resolve, close (with a reason), change category, assign to self, assign to others (acts as team leader), view unassigned tickets (team queue), view tickets assigned to others, view tickets of all teams. Reports: run reports for own tickets, run reports for everything inside the access, export tickets and reports (CSV). Customers: view customers, manage customers (create and edit), approve or reject new accounts. Administration: manage the knowledge base, categories and custom fields, settings (SLA, priorities), and saved replies shared with everyone. Viewing tickets inside the access is always on.",
      ar: "التذاكر: الرد، الحل، الإغلاق (مع سبب)، تغيير التصنيف، الإسناد للنفس، الإسناد للآخرين (بصفة قائد فريق)، عرض التذاكر غير المسندة (قائمة الفريق)، عرض التذاكر المسندة لآخرين، عرض تذاكر كل الفرق. التقارير: تقارير للتذاكر الخاصة، تقارير لكل ما ضمن النطاق، تصدير التذاكر والتقارير (CSV). العملاء: عرض العملاء، إدارة العملاء (إنشاء وتعديل)، الموافقة على الحسابات الجديدة أو رفضها. الإدارة: إدارة قاعدة المعرفة، والتصنيفات والحقول المخصصة، والإعدادات (اتفاقية الخدمة والأولويات)، والردود المحفوظة المشتركة. وعرض التذاكر ضمن النطاق مفعّل دائمًا.",
    },
  },
  {
    id: "perm-type", kind: "howto", area: "people", audience: [], path: "/admin/permissions",
    title: { en: "Create an account type and assign it", ar: "إنشاء نوع حساب وإسناده" },
    summary: { en: "Decide who can see and do what.", ar: "حدد من يرى ماذا ومن يفعل ماذا." },
    steps: [
      { en: "Open **Permissions** and the **Account types** tab, then create a type and enter its **Name**.", ar: "افتح **الصلاحيات** وتبويب **أنواع الحسابات** ثم أنشئ نوعًا وأدخل **اسمه**." },
      { en: "Choose the access: **All organizations and branches**, or **Selected organizations and branches**. Ticking an organization gives all its branches, including ones added later. Ticking only some branches limits the type to those.", ar: "اختر النطاق: **كل المؤسسات والفروع** أو **مؤسسات وفروع محددة**. تحديد المؤسسة يمنح كل فروعها بما فيها المضافة لاحقًا، وتحديد بعض الفروع يقصر النوع عليها." },
      { en: "Tick the permissions the type may use. The list unlocks once at least one organization is selected.", ar: "حدد الصلاحيات المسموحة للنوع. تُفتح القائمة بعد اختيار مؤسسة واحدة على الأقل." },
      { en: "Save. Then open the **Staff** tab and choose the account type for each person.", ar: "احفظ. ثم افتح تبويب **الموظفون** واختر نوع الحساب لكل شخص." },
    ],
    tips: [
      { en: "Give **Assign tickets to others** to make people with this type act as team leaders for their teams.", ar: "امنح **إسناد التذاكر للآخرين** لتصرّف أصحاب هذا النوع كقادة لفرقهم." },
      { en: "The built-in types **Organization Admin** and **Branch Admin** limit a person to chosen organizations or branches. Normally you do not set them here: choose the matching card when adding the person under Staff.", ar: "النوعان المدمجان **مدير المؤسسة** و**مدير الفرع** يقصران الشخص على مؤسسات أو فروع مختارة. وعادةً لا تضبطهما هنا، بل اختر البطاقة المناسبة عند إضافة الشخص ضمن «الموظفون»." },
      { en: "Choosing Administrator fills access with everything and asks for confirmation before saving.", ar: "اختيار «مدير» يملأ النطاق بكل شيء ويطلب تأكيدًا قبل الحفظ." },
    ],
  },
  {
    id: "audit-log", kind: "feature", area: "people", audience: [], path: "/admin/audit",
    title: { en: "Audit log", ar: "سجل التدقيق" },
    summary: {
      en: "Who changed what, newest first. It records status flow edits, escalations, sign-in code use, recalculated SLA deadlines and other administrative changes. Administrators and management viewers can open it.",
      ar: "من غيّر ماذا، الأحدث أولًا. يسجل تعديلات مسار الحالات والتصعيدات واستخدام رموز الدخول وإعادة حساب مواعيد اتفاقية الخدمة وغيرها من التغييرات الإدارية. يمكن للمديرين والمشاهدين الإداريين فتحه.",
    },
  },
];

export const ADMIN_A_FLOWS: Flow[] = [
  {
    id: "f-escalate", area: "sla", audience: ["agent"],
    title: { en: "Escalating a ticket", ar: "تصعيد تذكرة" },
    summary: { en: "The agent picks a leader from the list the administrator allowed, and must give a reason. The leader is emailed and the audit log records it.", ar: "يختار الموظف قائدًا من القائمة التي سمح بها المدير ويلزمه ذكر السبب. يصل القائد بريد ويُسجَّل ذلك في سجل التدقيق." },
    nodes: [
      { label: { en: "Agent selects Escalate", ar: "الموظف يختار تصعيد" }, tone: "a" },
      { label: { en: "Choose leader and reason", ar: "اختيار القائد والسبب" } },
      { label: { en: "Ticket moves to the leader", ar: "تنتقل التذكرة إلى القائد" }, tone: "d" },
      { label: { en: "Leader emailed, logged", ar: "بريد للقائد وتسجيل" }, tone: "o" },
    ],
  },
  {
    id: "f-setup", area: "people", audience: [],
    title: { en: "Setting up a new support operation", ar: "تجهيز عملية دعم جديدة" },
    summary: { en: "The order that avoids dead ends: people and places first, then rules, then wording.", ar: "الترتيب الذي يتفادى المآزق: الأشخاص والأماكن أولًا ثم القواعد ثم الصياغة." },
    nodes: [
      { label: { en: "Organizations and branches", ar: "المؤسسات والفروع" }, tone: "a" },
      { label: { en: "Staff and account types", ar: "الموظفون وأنواع الحسابات" } },
      { label: { en: "Teams", ar: "الفرق" } },
      { label: { en: "Priorities and SLA", ar: "الأولويات واتفاقية الخدمة" } },
      { label: { en: "Categories", ar: "التصنيفات" } },
      { label: { en: "Registration and emails", ar: "التسجيل والبريد" }, tone: "d" },
      { label: { en: "Go live", ar: "التشغيل" }, tone: "o" },
    ],
  },
  {
    id: "f-scoped-admin", area: "people", audience: [],
    title: { en: "Adding an Organization or Branch admin", ar: "إضافة مدير مؤسسة أو مدير فرع" },
    summary: { en: "One form does it all. Afterwards the new admin manages people only inside their scope.", ar: "نموذج واحد ينجز كل شيء. بعدها يدير المدير الجديد الأشخاص داخل نطاقه فقط." },
    nodes: [
      { label: { en: "Add staff", ar: "إضافة موظف" }, tone: "a" },
      { label: { en: "Tick Organization admin or Branch admin", ar: "تحديد مدير مؤسسة أو مدير فرع" } },
      { label: { en: "Choose organizations or branches", ar: "اختيار المؤسسات أو الفروع" } },
      { label: { en: "Create", ar: "إنشاء" } },
      { label: { en: "Admin manages People in their scope", ar: "يدير المدير الأشخاص داخل نطاقه" }, tone: "o" },
    ],
  },
  {
    id: "f-promote", area: "people", audience: [],
    title: { en: "Customer to staff and back", ar: "من عميل إلى موظف والعكس" },
    summary: { en: "History is always kept. Turning back removes team membership and open assignments.", ar: "يُحفظ السجل دائمًا. وإعادته عميلًا تزيل عضوية الفرق والإسناد المفتوح." },
    nodes: [
      { label: { en: "Customer", ar: "عميل" } },
      { label: { en: "Choose staff role", ar: "اختيار دور موظف" }, tone: "a" },
      { label: { en: "Staff member, emailed", ar: "موظف ويصله بريد" }, tone: "o" },
      { label: { en: "Turn back into a customer", ar: "إعادته عميلًا" }, tone: "d" },
    ],
  },
];
