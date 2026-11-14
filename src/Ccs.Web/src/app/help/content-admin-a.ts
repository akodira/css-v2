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
    summary: { en: "Deadlines for each priority, and when they count.", ar: "المواعيد النهائية لكل أولوية ومتى تُحتسب." },
    rule: { en: "Targets count working minutes only, inside the business calendar that applies to the ticket.", ar: "تُحتسب الأهداف بدقائق العمل فقط داخل تقويم العمل المنطبق على التذكرة." },
    points: [
      { en: "Response and resolution targets for each priority.", ar: "أهداف الاستجابة والحل لكل أولوية." },
      { en: "Working hours and holidays.", ar: "ساعات العمل والعطلات." },
      { en: "Who is told when a deadline is close or missed.", ar: "من يُبلَّغ عند اقتراب الموعد أو تجاوزه." },
    ],
    notes: [
      { en: "Changes apply to new tickets and to tickets whose priority changes. Tickets already open keep their deadlines until you recalculate them.", ar: "تسري التغييرات على التذاكر الجديدة وعلى التذاكر التي تتغير أولويتها، أما المفتوحة فتحتفظ بمواعيدها حتى تعيد حسابها." },
    ],
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
    summary: { en: "Decide, for each organization and branch, which leaders an agent can send a ticket to.", ar: "حدد لكل مؤسسة وفرع القادة الذين يمكن للموظف إحالة التذكرة إليهم." },
    rule: { en: "Leaders come from the organization tree: the branch leader first, then each organization leader up to the top.", ar: "يأتي القادة من شجرة المؤسسات: قائد الفرع أولًا ثم قائد كل مؤسسة صعودًا." },
    optionsTitle: { en: "Three settings", ar: "ثلاثة إعدادات" },
    options: [
      { name: { en: "Any leader above", ar: "أي قائد أعلى" }, tone: "brand", text: { en: "A dropdown of all of them, nearest first.", ar: "قائمة بكلهم، الأقرب أولًا." } },
      { name: { en: "Next leader only", ar: "القائد التالي فقط" }, tone: "purple", text: { en: "Only the nearest leader above.", ar: "القائد الأقرب فقط." } },
      { name: { en: "Escalation off", ar: "إيقاف التصعيد" }, tone: "neutral", text: { en: "Agents cannot escalate.", ar: "لا يستطيع الموظف التصعيد." } },
    ],
    notes: [
      { en: "A branch setting overrides its organization.", ar: "إعداد الفرع يتقدم على إعداد مؤسسته." },
    ],
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
    summary: { en: "How customers describe their request when they open a ticket.", ar: "كيف يصف العميل طلبه عند فتح تذكرة." },
    options: [
      { name: { en: "Ticket types", ar: "أنواع التذاكر" }, tone: "brand", text: { en: "Picked first; they decide which categories the customer sees.", ar: "تُختار أولًا وتحدد التصنيفات التي يراها العميل." } },
      { name: { en: "Categories and subcategories", ar: "التصنيفات والتصنيفات الفرعية" }, tone: "purple", points: [
        { en: "What customers choose when they open a ticket.", ar: "ما يختاره العميل عند فتح تذكرة." },
        { en: "Each can have a default team, automatic assignment and a fixed priority.", ar: "لكل منها فريق افتراضي وإسناد تلقائي وأولوية ثابتة." },
        { en: "Or be private (staff only).", ar: "أو يمكن جعله خاصًا (للموظفين فقط)." },
      ] },
      { name: { en: "Custom fields", ar: "الحقول المخصصة" }, tone: "ok", text: { en: "Add extra questions to the ticket form.", ar: "تضيف أسئلة إضافية إلى نموذج التذكرة." } },
    ],
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
    summary: { en: "The priorities used on tickets.", ar: "الأولويات المستخدمة في التذاكر." },
    rule: { en: "Normal is the default: it can be renamed but not deleted or deactivated.", ar: "«عادية» هي الافتراضية: يمكن إعادة تسميتها لكن لا يمكن حذفها أو إيقافها." },
    optionsTitle: { en: "How a new ticket gets its priority", ar: "كيف تحصل التذكرة الجديدة على أولويتها" },
    options: [
      { name: { en: "From the system", ar: "من النظام" }, tone: "brand", text: { en: "The category sets it, otherwise Normal.", ar: "يحددها التصنيف وإلا «عادية»." } },
      { name: { en: "Chosen by the customer", ar: "يختارها العميل" }, tone: "purple", text: { en: "And by staff when they create a ticket for a customer.", ar: "ويختارها الموظف عند إنشاء تذكرة لعميل." } },
    ],
    points: [
      { en: "Each has a name in both languages, a colour, an order and its own SLA targets.", ar: "لكل أولوية اسم بالعربية والإنجليزية ولون وترتيب وأهداف خدمة خاصة بها." },
    ],
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
    summary: { en: "Every ticket is always in one of eight statuses.", ar: "تكون كل تذكرة دائمًا في إحدى ثماني حالات." },
    rule: { en: "What a status does cannot be removed: Pending customer always pauses the service clock, and Resolved always needs a resolution summary.", ar: "وظيفة الحالة لا تُزال: «بانتظار العميل» توقف دائمًا ساعة الخدمة، و«تم الحل» تتطلب دائمًا ملخص حل." },
    points: [
      { en: "Rename them and change their colour and description.", ar: "أعد تسميتها وغيّر لونها ووصفها." },
      { en: "Choose what customers see.", ar: "حدد ما يراه العميل." },
      { en: "Decide who may move a ticket from one status to another.", ar: "حدد من يستطيع نقل التذكرة من حالة إلى أخرى." },
    ],
    notes: [
      { en: "A separate guide explains every status, timer, reason and SLA rule in plain language.", ar: "ويشرح دليل مستقل كل حالة ومؤقت وسبب وقاعدة لاتفاقية الخدمة بلغة مبسطة." },
    ],
  },
  {
    id: "status-guide", kind: "feature", area: "catalog", audience: [], perm: "manage_settings", path: "/admin/ticket-status/guide",
    title: { en: "Ticket lifecycle guide", ar: "دليل دورة حياة التذكرة" },
    summary: { en: "A plain-language guide for administrators and team leaders.", ar: "دليل مبسط للمديرين وقادة الفرق." },
    points: [
      { en: "Every status, timer, closure reason and SLA rule.", ar: "كل حالة ومؤقت وسبب إغلاق وقاعدة لاتفاقية الخدمة." },
      { en: "How a ticket moves from New to Closed, and how to change that.", ar: "كيف تنتقل التذكرة من جديدة إلى مغلقة وكيف تغيّر ذلك." },
      { en: "How the service clocks and calendars work.", ar: "كيف تعمل ساعات الخدمة والتقاويم." },
    ],
    notes: [
      { en: "Open it from the Ticket status page when you are not sure what a setting does.", ar: "افتحه من صفحة حالة التذكرة عندما لا تعرف ما يفعله إعداد ما." },
    ],
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
    summary: { en: "Who does what in the system.", ar: "من يفعل ماذا في النظام." },
    rule: { en: "What a person can finally do is decided by their account type under Permissions.", ar: "ما يستطيع الشخص فعله فعليًا يحدده نوع حسابه ضمن الصلاحيات." },
    options: [
      { name: { en: "Customer", ar: "العميل" }, tone: "neutral", text: { en: "Asks for help and follows their own requests.", ar: "يطلب المساعدة ويتابع طلباته." } },
      { name: { en: "Agent", ar: "الموظف" }, tone: "brand", text: { en: "Works tickets and answers customers.", ar: "يعالج التذاكر ويجيب العملاء." } },
      { name: { en: "Team leader", ar: "قائد الفريق" }, tone: "purple", text: { en: "An agent who also directs the team and assigns tickets.", ar: "موظف يوجّه الفريق ويسند التذاكر أيضًا." } },
      { name: { en: "Administrator", ar: "المدير" }, tone: "danger", text: { en: "Runs the whole system.", ar: "يدير النظام كله." } },
      { name: { en: "Management viewer", ar: "المشاهد الإداري" }, tone: "ok", text: { en: "Watches dashboards, reports and tickets without changing anything.", ar: "يطّلع على اللوحات والتقارير والتذاكر دون تغيير شيء." } },
      { name: { en: "Organization admin and Branch admin", ar: "مدير المؤسسة ومدير الفرع" }, tone: "warn", text: { en: "An agent who also manages the people, approvals and tickets of only the organizations or branches chosen for them.", ar: "موظف يدير أيضًا الأشخاص والموافقات والتذاكر في المؤسسات أو الفروع المختارة له فقط." } },
    ],
    notes: [
      { en: "A customer role cannot be combined with staff roles.", ar: "لا يمكن الجمع بين دور العميل وأدوار الموظفين." },
    ],
  },
  {
    id: "users-overview", kind: "feature", area: "people", audience: [], path: "/admin/users",
    title: { en: "Staff", ar: "الموظفون" },
    summary: { en: "Agents, team leaders, administrators and management viewers.", ar: "الموظفون وقادة الفرق والمديرون والمشاهدون الإداريون." },
    points: [
      { en: "Search, add, edit, suspend and reactivate them.", ar: "ابحث وأضف وعدّل وأوقف وأعد التفعيل." },
    ],
    notes: [
      { en: "A person with tickets, messages or other history cannot be deleted: suspend the account instead.", ar: "لا يمكن حذف شخص لديه تذاكر أو رسائل أو سجل آخر، أوقف حسابه بدلًا من ذلك." },
      { en: "Customers are managed under Customers.", ar: "تُدار حسابات العملاء ضمن «العملاء»." },
    ],
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
      { en: "Select **Create**. Copy the temporary password now: it is shown only once. Give it to the person, who can change it under My Account.", ar: "اختر **إنشاء**. انسخ كلمة المرور المؤقتة الآن فهي تظهر مرة واحدة فقط. سلّمها للشخص ويمكنه تغييرها من حسابي." },
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
    summary: { en: "All customers, with organization, branch, status and ticket counts.", ar: "كل العملاء مع المؤسسة والفرع والحالة وعدد التذاكر." },
    optionsTitle: { en: "Account statuses", ar: "حالات الحساب" },
    options: [
      { name: { en: "Active", ar: "نشط" }, tone: "ok" },
      { name: { en: "Suspended", ar: "موقوف" }, tone: "danger" },
      { name: { en: "Waiting for email verification", ar: "بانتظار تأكيد البريد" }, tone: "warn" },
      { name: { en: "Waiting for administrator approval", ar: "بانتظار موافقة المدير" }, tone: "brand" },
    ],
    points: [
      { en: "Add a customer and edit their details.", ar: "أضف عميلًا وعدّل بياناته." },
      { en: "Change their organization and branch.", ar: "غيّر مؤسسته وفرعه." },
      { en: "Approve or reject new sign-ups.", ar: "وافق على التسجيلات الجديدة أو ارفضها." },
      { en: "Suspend or reactivate the account.", ar: "أوقف الحساب أو أعد تفعيله." },
    ],
    notes: [
      { en: "A customer with tickets cannot be deleted: suspend the account instead.", ar: "لا يمكن حذف عميل لديه تذاكر، أوقف حسابه بدلًا من ذلك." },
    ],
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
    summary: { en: "A team is a group of agents who share a queue.", ar: "الفريق مجموعة موظفين يتشاركون قائمة واحدة." },
    points: [
      { en: "Categories send tickets to a default team.", ar: "ترسل التصنيفات التذاكر إلى فريق افتراضي." },
      { en: "Members must already have the Agent or Team leader role.", ar: "يجب أن يكون الأعضاء حاصلين مسبقًا على دور موظف أو قائد فريق." },
    ],
    notes: [
      { en: "A team with tickets, or used as a category default, cannot be deleted: deactivate it.", ar: "لا يمكن حذف فريق لديه تذاكر أو مستخدم كافتراضي لتصنيف، أوقفه بدلًا من ذلك." },
    ],
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
    summary: { en: "Where customers belong: organizations and their branches.", ar: "إلى أين ينتمي العملاء: المؤسسات وفروعها." },
    rule: { en: "Organizations form a tree: an organization includes the organizations below it.", ar: "تشكل المؤسسات شجرة: تشمل المؤسسة ما تحتها." },
    points: [
      { en: "Each organization has a location, a telephone and an assigned team leader.", ar: "لكل مؤسسة موقع وهاتف وقائد فريق معيّن." },
      { en: "It can have branches with the same details.", ar: "ويمكن أن تضم فروعًا بالبيانات نفسها." },
      { en: "Customers belong to an organization and a branch.", ar: "ينتمي العملاء إلى مؤسسة وفرع." },
    ],
    notes: [
      { en: "An organization with customers or branches cannot be deleted: deactivate it.", ar: "لا يمكن حذف مؤسسة لديها عملاء أو فروع، أوقفها بدلًا من ذلك." },
    ],
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
    summary: { en: "An account type is a named set of permissions plus the organizations and branches it can access.", ar: "نوع الحساب مجموعة مسماة من الصلاحيات مع المؤسسات والفروع التي يمكنه الوصول إليها." },
    rule: { en: "Administrator is built in: it has every permission everywhere, now and in the future, and cannot be changed or deleted.", ar: "المدير نوع مدمج له كل الصلاحيات في كل مكان الآن ومستقبلًا، ولا يمكن تغييره أو حذفه." },
    points: [
      { en: "Each staff member gets one type.", ar: "يحصل كل موظف على نوع واحد." },
      { en: "Changing a type changes everyone who has it.", ar: "تغيير النوع يغيّر كل من يحمله." },
    ],
    notes: [
      { en: "You cannot change your own type, and the last administrator cannot be changed.", ar: "لا يمكنك تغيير نوع حسابك، ولا يمكن تغيير آخر مدير." },
    ],
  },
  {
    id: "perm-list", kind: "feature", area: "people", audience: [], path: "/admin/permissions",
    title: { en: "What each permission allows", ar: "ما تتيحه كل صلاحية" },
    summary: { en: "The permissions an account type can include, by area.", ar: "الصلاحيات التي يمكن أن يتضمنها نوع الحساب، حسب المجال." },
    rule: { en: "Viewing tickets inside the access is always on.", ar: "عرض التذاكر ضمن النطاق مفعّل دائمًا." },
    options: [
      { name: { en: "Tickets", ar: "التذاكر" }, tone: "brand", points: [
        { en: "Reply, resolve, close (with a reason).", ar: "الرد والحل والإغلاق (مع سبب)." },
        { en: "Change category.", ar: "تغيير التصنيف." },
        { en: "Assign to self; assign to others (acts as team leader).", ar: "الإسناد للنفس، والإسناد للآخرين (بصفة قائد فريق)." },
        { en: "View unassigned tickets (team queue), tickets assigned to others, and tickets of all teams.", ar: "عرض التذاكر غير المسندة (قائمة الفريق)، والمسندة لآخرين، وتذاكر كل الفرق." },
      ] },
      { name: { en: "Reports", ar: "التقارير" }, tone: "purple", points: [
        { en: "Run reports for own tickets.", ar: "تقارير للتذاكر الخاصة." },
        { en: "Run reports for everything inside the access.", ar: "تقارير لكل ما ضمن النطاق." },
        { en: "Export tickets and reports (CSV).", ar: "تصدير التذاكر والتقارير (CSV)." },
      ] },
      { name: { en: "Customers", ar: "العملاء" }, tone: "ok", points: [
        { en: "View customers.", ar: "عرض العملاء." },
        { en: "Manage customers (create and edit).", ar: "إدارة العملاء (إنشاء وتعديل)." },
        { en: "Approve or reject new accounts.", ar: "الموافقة على الحسابات الجديدة أو رفضها." },
      ] },
      { name: { en: "Administration", ar: "الإدارة" }, tone: "warn", points: [
        { en: "Manage the knowledge base.", ar: "إدارة قاعدة المعرفة." },
        { en: "Categories and custom fields.", ar: "التصنيفات والحقول المخصصة." },
        { en: "Settings (SLA, priorities).", ar: "الإعدادات (اتفاقية الخدمة والأولويات)." },
        { en: "Saved replies shared with everyone.", ar: "الردود المحفوظة المشتركة." },
      ] },
    ],
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
    summary: { en: "Who changed what, newest first.", ar: "من غيّر ماذا، الأحدث أولًا." },
    points: [
      { en: "Status flow edits and escalations.", ar: "تعديلات مسار الحالات والتصعيدات." },
      { en: "Sign-in code use and recalculated SLA deadlines.", ar: "استخدام رموز الدخول وإعادة حساب مواعيد اتفاقية الخدمة." },
      { en: "Other administrative changes.", ar: "وغيرها من التغييرات الإدارية." },
    ],
    notes: [
      { en: "Administrators and management viewers can open it. Management viewers see which fields changed, not the old and new values.", ar: "يمكن للمديرين والمشاهدين الإداريين فتحه، ويرى المشاهدون الإداريون الحقول التي تغيّرت دون القيم القديمة والجديدة." },
    ],
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
