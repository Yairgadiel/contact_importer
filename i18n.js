(function () {
  'use strict';

  const TEXTS = {
    title: 'ייבוא אנשי קשר · סורק כרטיסי ביקור',
    description: 'סרוק תמונות בעברית, מפה את השורות שזוהו לשדות קשר וייצא קובץ vCard.',
    app: {
      name: 'ייבוא אנשי קשר',
      tagline: 'סורק כרטיסי ביקור בעברית',
      config: 'הגדרת שדות',
    },
    scan: {
      title: 'העלה תמונה או צלם כרטיס ביקור',
      formats: 'JPG · PNG · WebP · אפשר גם הדבקה (Ctrl+V)',
      camera: 'צילום מהמצלמה',
      analyze: 'סריקה וזיהוי שורות',
      analyze_note: 'התמונה נשלחת לשם זיהוי הטקסט',
      loading: 'מזהה את השורות בתמונה…',
    },
    results: {
      title: 'השורות שזוהו · מיפוי לשדות',
      hint: 'כל שורה מוצגת עם בחירת יעד חכמה מראש. אפשר לשנות ידנית, ולסמן "התעלם" לשורות שלא רלוונטיות.',
      count: 'שורות זוהו',
      contact: 'איש קשר',
      group_standard: 'שדות סטנדרטיים',
      group_custom: 'שדות מותאמים',
      ignore: 'התעלם',
      empty: 'לא זוהו שורות בתמונה.',
      save: 'הוספה לאנשי קשר (.vcf)',
      new_scan: 'סריקה חדשה',
      multi_hint: 'זוהו {n} אנשי קשר. ב-iOS: בתפריט השיתוף בחרו "שמירה בקבצים", פתחו את הקובץ ב"קבצים", שתפו ל"אנשי קשר" ולחצו "הוסף את כל {n} אנשי הקשר".',
    },
    config: {
      title: 'הגדרת שדות',
      close: 'סגירה',
      subtitle: 'בחרו אילו שדות יופיעו בתפריט המיפוי. ההגדרה נשמרת במכשיר.',
      standard_title: 'שדות סטנדרטיים',
      custom_title: 'שדות מותאמים אישית',
      empty_custom: 'לא הוגדרו שדות מותאמים. לדוגמה: תעודת זהות, מידת חולצה…',
      add_custom: '+ הוספת שדה מותאם',
      name_placeholder: 'שם השדה, למשל: תעודת זהות',
      desc_placeholder: 'תיאור (אופציונלי)',
      remove: 'הסר שדה',
      save: 'שמירה',
      cancel: 'ביטול',
    },
    fields: {
      first_name: 'שם פרטי',
      last_name: 'שם משפחה',
      phone: 'טלפון',
      email: 'אימייל',
      organization: 'חברה',
      title: 'תפקיד',
      address: 'כתובת',
      notes: 'הערה',
    },
    toast: {
      not_image: 'נא לבחור קובץ תמונה',
      pasted: 'התמונה הודבקה מהלוח',
      no_fields: 'לא הוגדרו שדות — פתחו את הגדרות השדות',
      rows_found: 'זוהו {n} שורות · נבחרה יעד לכל שורה',
      config_saved: 'הגדרות השדות נשמרו',
      storage_error: 'שמירה בהתקן לא אפשרית',
      no_mapping: 'לא נבחרו שורות למיפוי — בחרו יעד לכל שורה או סמנו "התעלם"',
      vcard_ready: 'קובץ ה-vCard נוצר · פתחו אותו כדי לשמור באנשי הקשר',
    },
    status: {
      no_data: 'לא זוהו נתונים בתמונה. נסו תמונה חדה יותר.',
      generic_error: 'אירעה שגיאה, נסו שוב',
      try_again: 'השירות עמוס כרגע. נסו שוב מאוחר יותר.',
      server_error: 'השרת החזיר שגיאה',
      image_read_error: 'לא ניתן לקרוא את התמונה',
    },
    footer: {
      text: 'נתוני התמונה נשלחים ל- Gemini API לצורך זיהוי הטקסט בלבד.\nההגדרות והמיפוי נשמרים מקומית במכשיר.',
    },
  };

  function t(key, args) {
    let val = TEXTS;
    const parts = key.split('.');
    for (const p of parts) {
      if (val == null || typeof val !== 'object') return key;
      val = val[p];
    }
    if (typeof val !== 'string') return key;
    if (args) {
      for (const k of Object.keys(args)) {
        val = val.split('{' + k + '}').join(args[k]);
      }
    }
    return val;
  }

  function applyTexts() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(function (el) {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
  }

  window.TEXTS = TEXTS;
  window.t = t;
  window.applyTexts = applyTexts;

  document.title = t('title');
  const descMeta = document.querySelector('meta[name="description"]');
  if (descMeta) descMeta.setAttribute('content', t('description'));
  const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (appleTitle) appleTitle.setAttribute('content', t('app.name'));
  applyTexts();
})();
