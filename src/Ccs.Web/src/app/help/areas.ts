import type { Area } from "./types";

export const AREAS: Area[] = [
  { id: "tickets", title: { en: "Tickets", ar: "التذاكر" }, blurb: { en: "Open, follow and work support requests.", ar: "فتح طلبات الدعم ومتابعتها ومعالجتها." } },
  { id: "customers", title: { en: "Customers", ar: "العملاء" }, blurb: { en: "Customer accounts, approvals and history.", ar: "حسابات العملاء والموافقات والسجل." } },
  { id: "kb", title: { en: "Knowledge base", ar: "قاعدة المعرفة" }, blurb: { en: "Articles that answer common questions.", ar: "مقالات تجيب عن الأسئلة الشائعة." } },
  { id: "account", title: { en: "My Account", ar: "حسابي" }, blurb: { en: "Sign-in, password, security and language.", ar: "تسجيل الدخول وكلمة المرور والأمان واللغة." } },
  { id: "reports", title: { en: "Dashboard and reports", ar: "لوحة المتابعة والتقارير" }, blurb: { en: "Numbers on volume, speed and satisfaction.", ar: "أرقام الحجم والسرعة والرضا." } },
  { id: "sla", title: { en: "SLA and escalation", ar: "اتفاقيات الخدمة والتصعيد" }, blurb: { en: "Deadlines and what happens when they are missed.", ar: "المواعيد النهائية وما يحدث عند تجاوزها." } },
  { id: "catalog", title: { en: "Categories and statuses", ar: "التصنيفات والحالات" }, blurb: { en: "How tickets are organised and how they move.", ar: "كيف تُنظَّم التذاكر وكيف تنتقل بين الحالات." } },
  { id: "people", title: { en: "People and access", ar: "المستخدمون والصلاحيات" }, blurb: { en: "Staff, teams, organizations and permissions.", ar: "الموظفون والفرق والمؤسسات والصلاحيات." } },
  { id: "system", title: { en: "System rules and security", ar: "قواعد النظام والأمان" }, blurb: { en: "Registration, reminders, passwords, captcha, sign-in codes, uploads and handover.", ar: "التسجيل والتذكيرات وكلمات المرور والكابتشا ورموز الدخول والرفع والتسليم." } },
  { id: "email", title: { en: "Email and notifications", ar: "البريد والإشعارات" }, blurb: { en: "What the system sends and how it looks.", ar: "ما يرسله النظام وكيف يبدو." } },
  { id: "site", title: { en: "Site settings", ar: "إعدادات الموقع" }, blurb: { en: "Branding, menus, home page and system rules.", ar: "الهوية والقوائم والصفحة الرئيسية وقواعد النظام." } },
];
