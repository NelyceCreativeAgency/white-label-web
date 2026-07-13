// Per-service customization parameters.
// Pricing model: total = (basePrice + sum of additive extras) * units
// "units" comes from the one param flagged role:"multiplier" (defaults to 1 if none).
const SERVICE_PARAMS = {

    "homepage-design": [
        { key: "revisions", type: "stepper", label: { el: "Επιπλέον Rounds Αναθεώρησης", en: "Extra Revision Rounds" }, min: 0, max: 5, default: 0, pricePerUnit: 48 },
        { key: "animation", type: "toggle", label: { el: "Micro-animations / Interactions", en: "Micro-animations / Interactions" }, price: 144 }
    ],

    "internal-pages": [
        { key: "pages", type: "stepper", role: "multiplier", label: { el: "Αριθμός Σελίδων", en: "Number of Pages" }, min: 1, max: 20, default: 1, pricePerUnit: 0 },
        { key: "complexity", type: "select", label: { el: "Πολυπλοκότητα ανά Σελίδα", en: "Complexity per Page" }, options: [
            { label: { el: "Απλή", en: "Basic" }, price: 0, note: { el: "Τυπικό layout με στατικό περιεχόμενο", en: "Standard layout with static content" } },
            { label: { el: "Σύνθετη", en: "Advanced" }, price: 60, note: { el: "Custom sections, interactive στοιχεία", en: "Custom sections, interactive elements" } }
        ]},
        { key: "illustrations", type: "toggle", label: { el: "Custom Illustrations ανά Σελίδα", en: "Custom Illustrations per Page" }, price: 48 }
    ],

    "basic-logo": [
        { key: "concepts", type: "stepper", label: { el: "Επιπλέον Προτάσεις", en: "Extra Concepts" }, min: 0, max: 5, default: 0, pricePerUnit: 120 },
        { key: "revisions", type: "stepper", label: { el: "Επιπλέον Αναθεωρήσεις", en: "Extra Revisions" }, min: 0, max: 5, default: 0, pricePerUnit: 60 },
        { key: "socialkit", type: "toggle", label: { el: "Social Media Kit", en: "Social Media Kit" }, price: 96 }
    ],

    "plus-brand": [
        { key: "concepts", type: "stepper", label: { el: "Επιπλέον Προτάσεις", en: "Extra Concepts" }, min: 0, max: 5, default: 0, pricePerUnit: 120 },
        { key: "revisions", type: "stepper", label: { el: "Επιπλέον Αναθεωρήσεις", en: "Extra Revisions" }, min: 0, max: 5, default: 0, pricePerUnit: 72 },
        { key: "customgraphics", type: "toggle", label: { el: "Custom Graphics / Patterns", en: "Custom Graphics / Patterns" }, price: 300 },
        { key: "stationery", type: "toggle", label: { el: "Σχεδιασμός Stationery (κάρτες κ.λπ.)", en: "Stationery Design (cards, etc.)" }, price: 144 }
    ],

    "full-brand": [
        { key: "concepts", type: "stepper", label: { el: "Επιπλέον Προτάσεις", en: "Extra Concepts" }, min: 0, max: 5, default: 0, pricePerUnit: 144 },
        { key: "revisions", type: "stepper", label: { el: "Επιπλέον Αναθεωρήσεις", en: "Extra Revisions" }, min: 0, max: 5, default: 0, pricePerUnit: 84 },
        { key: "customgraphics", type: "toggle", label: { el: "Custom Graphics / Illustrations", en: "Custom Graphics / Illustrations" }, price: 240 }
    ],

    "full-brand-custom": [
        { key: "concepts", type: "stepper", label: { el: "Επιπλέον Προτάσεις", en: "Extra Concepts" }, min: 0, max: 5, default: 0, pricePerUnit: 180 },
        { key: "revisions", type: "stepper", label: { el: "Επιπλέον Αναθεωρήσεις", en: "Extra Revisions" }, min: 0, max: 5, default: 0, pricePerUnit: 96 },
        { key: "illustrations", type: "stepper", label: { el: "Αριθμός Custom Εικονογραφήσεων", en: "Number of Custom Illustrations" }, min: 0, max: 10, default: 0, pricePerUnit: 72 }
    ],

    "extra-concepts": [
        { key: "concepts", type: "stepper", role: "multiplier", label: { el: "Αριθμός Προτάσεων", en: "Number of Concepts" }, min: 1, max: 10, default: 1, pricePerUnit: 0 },
        { key: "rush", type: "toggle", label: { el: "Rush Delivery", en: "Rush Delivery" }, price: 60 }
    ],

    "responsive-theme": [
        { key: "pages", type: "stepper", label: { el: "Αριθμός Σελίδων", en: "Number of Pages" }, min: 1, max: 15, default: 5, baseline: 5, pricePerUnit: 156 },
        { key: "languages", type: "stepper", label: { el: "Αριθμός Γλωσσών", en: "Number of Languages" }, min: 0, max: 5, default: 0, pricePerUnit: 360 },
        { key: "complexity", type: "select", label: { el: "Επίπεδο Λειτουργιών", en: "Feature Complexity" }, options: [
            { label: { el: "Βασική", en: "Basic" }, price: 0, note: { el: "Στατικές φόρμες, βασική λειτουργικότητα", en: "Static forms, basic functionality" } },
            { label: { el: "Προχωρημένη", en: "Advanced" }, price: 480, note: { el: "Dynamic filters, integrations, custom λειτουργίες", en: "Dynamic filters, integrations, custom functions" } }
        ]}
    ],

    "full-custom-website": [
        { key: "pages", type: "stepper", label: { el: "Αριθμός Σελίδων", en: "Number of Pages" }, min: 1, max: 20, default: 5, baseline: 5, pricePerUnit: 216 },
        { key: "languages", type: "stepper", label: { el: "Αριθμός Γλωσσών", en: "Number of Languages" }, min: 0, max: 5, default: 0, pricePerUnit: 420 },
        { key: "complexity", type: "select", label: { el: "Πολυπλοκότητα Custom Λειτουργιών", en: "Custom Feature Complexity" }, options: [
            { label: { el: "Βασική", en: "Basic" }, price: 0, note: { el: "Στατικό περιεχόμενο, βασικές φόρμες", en: "Static content, basic forms" } },
            { label: { el: "Προχωρημένη", en: "Advanced" }, price: 720, note: { el: "Dynamic λειτουργίες, integrations, dashboards", en: "Dynamic functions, integrations, dashboards" } },
            { label: { el: "Enterprise", en: "Enterprise" }, price: 1800, note: { el: "Πολύπλοκα συστήματα, custom APIs, automations", en: "Complex systems, custom APIs, automations" } }
        ]}
    ],

    "full-package": [
        { key: "pages", type: "stepper", label: { el: "Αριθμός Σελίδων", en: "Number of Pages" }, min: 1, max: 20, default: 5, baseline: 5, pricePerUnit: 240 },
        { key: "languages", type: "stepper", label: { el: "Αριθμός Γλωσσών", en: "Number of Languages" }, min: 0, max: 5, default: 0, pricePerUnit: 480 },
        { key: "customgraphics", type: "toggle", label: { el: "Custom Illustrations / Graphics", en: "Custom Illustrations / Graphics" }, price: 420 }
    ],

    "ai-responsive-website": [
        { key: "pages", type: "stepper", label: { el: "Αριθμός Σελίδων", en: "Number of Pages" }, min: 1, max: 15, default: 5, baseline: 5, pricePerUnit: 108 },
        { key: "chatbot", type: "toggle", label: { el: "AI Chatbot Integration", en: "AI Chatbot Integration" }, price: 240 }
    ],

    "ai-static-website": [
        { key: "pages", type: "stepper", label: { el: "Αριθμός Σελίδων", en: "Number of Pages" }, min: 1, max: 10, default: 4, baseline: 4, pricePerUnit: 84 },
        { key: "seo", type: "toggle", label: { el: "Επιπλέον SEO Optimization", en: "Extra SEO Optimization" }, price: 120 }
    ],

    "ai-static-template": [
        { key: "pages", type: "stepper", label: { el: "Αριθμός Σελίδων", en: "Number of Pages" }, min: 1, max: 10, default: 3, baseline: 3, pricePerUnit: 60 },
        { key: "seo", type: "toggle", label: { el: "Επιπλέον SEO Optimization", en: "Extra SEO Optimization" }, price: 96 }
    ],

    "ai-responsive-template": [
        { key: "pages", type: "stepper", label: { el: "Αριθμός Σελίδων", en: "Number of Pages" }, min: 1, max: 10, default: 5, baseline: 5, pricePerUnit: 72 }
    ],

    "cms-setup": [
        { key: "contenttypes", type: "stepper", label: { el: "Επιπλέον Τύποι Περιεχομένου", en: "Extra Content Types" }, min: 0, max: 10, default: 0, pricePerUnit: 48 },
        { key: "training", type: "toggle", label: { el: "Εκπαίδευση Χρήσης CMS", en: "CMS Usage Training" }, price: 84 }
    ],

    "static-management": [
        { key: "months", type: "stepper", role: "multiplier", label: { el: "Διάρκεια σε Μήνες", en: "Duration in Months" }, min: 1, max: 24, default: 1, pricePerUnit: 0 },
        { key: "extraupdates", type: "toggle", label: { el: "Extra Ενημερώσεις Περιεχομένου / μήνα", en: "Extra Content Updates / month" }, price: 30 }
    ],

    "shopify-theme": [
        { key: "productBlocks", type: "stepper", label: { el: "Καταχώρηση Προϊόντων από εμάς (ανά 50)", en: "Product Data Entry by Us (per 50)" }, min: 0, max: 10, default: 0, pricePerUnit: 60 },
        { key: "languages", type: "stepper", label: { el: "Αριθμός Γλωσσών", en: "Number of Languages" }, min: 0, max: 5, default: 0, pricePerUnit: 240 },
        { key: "payment", type: "toggle", label: { el: "Επιπλέον Payment Gateway", en: "Extra Payment Gateway" }, price: 96 }
    ],

    "eshop-template": [
        { key: "productBlocks", type: "stepper", label: { el: "Καταχώρηση Προϊόντων από εμάς (ανά 50)", en: "Product Data Entry by Us (per 50)" }, min: 0, max: 10, default: 0, pricePerUnit: 96 },
        { key: "languages", type: "stepper", label: { el: "Αριθμός Γλωσσών", en: "Number of Languages" }, min: 0, max: 5, default: 0, pricePerUnit: 300 },
        { key: "payment", type: "toggle", label: { el: "Επιπλέον Payment Gateway", en: "Extra Payment Gateway" }, price: 96 }
    ],

    "custom-eshop": [
        { key: "productBlocks", type: "stepper", label: { el: "Καταχώρηση Προϊόντων από εμάς (ανά 50)", en: "Product Data Entry by Us (per 50)" }, min: 0, max: 10, default: 0, pricePerUnit: 120 },
        { key: "languages", type: "stepper", label: { el: "Αριθμός Γλωσσών", en: "Number of Languages" }, min: 0, max: 5, default: 0, pricePerUnit: 420 },
        { key: "erp", type: "toggle", label: { el: "Σύνδεση ERP / CRM", en: "ERP / CRM Integration" }, price: 720 }
    ],

    "full-ecommerce": [
        { key: "productBlocks", type: "stepper", label: { el: "Καταχώρηση Προϊόντων από εμάς (ανά 50)", en: "Product Data Entry by Us (per 50)" }, min: 0, max: 10, default: 0, pricePerUnit: 144 },
        { key: "languages", type: "stepper", label: { el: "Αριθμός Γλωσσών", en: "Number of Languages" }, min: 0, max: 5, default: 0, pricePerUnit: 480 },
        { key: "erp", type: "toggle", label: { el: "Σύνδεση ERP / CRM", en: "ERP / CRM Integration" }, price: 840 },
        { key: "customgraphics", type: "toggle", label: { el: "Custom Illustrations", en: "Custom Illustrations" }, price: 420 }
    ],

    "multilingual": [
        { key: "languages", type: "stepper", role: "multiplier", label: { el: "Αριθμός Επιπλέον Γλωσσών", en: "Number of Extra Languages" }, min: 1, max: 5, default: 1, pricePerUnit: 0 }
    ],

    "video-basic-motion": [
        { key: "minutes", type: "stepper", label: { el: "Επιπλέον Λεπτά", en: "Extra Minutes" }, min: 0, max: 30, default: 0, pricePerUnit: 72 },
        { key: "revisions", type: "stepper", label: { el: "Επιπλέον Αναθεωρήσεις", en: "Extra Revisions" }, min: 0, max: 5, default: 0, pricePerUnit: 36 }
    ],

    "video-complex-motion": [
        { key: "minutes", type: "stepper", label: { el: "Επιπλέον Λεπτά", en: "Extra Minutes" }, min: 0, max: 30, default: 0, pricePerUnit: 120 },
        { key: "revisions", type: "stepper", label: { el: "Επιπλέον Αναθεωρήσεις", en: "Extra Revisions" }, min: 0, max: 5, default: 0, pricePerUnit: 48 }
    ],

    "reel-editing": [
        { key: "seconds", type: "stepper", label: { el: "Επιπλέον Δευτερόλεπτα (x15\")", en: "Extra Seconds (x15\")" }, min: 0, max: 4, default: 0, pricePerUnit: 18 },
        { key: "multiformat", type: "toggle", label: { el: "Εξαγωγή για Reels + Stories + TikTok", en: "Export for Reels + Stories + TikTok" }, price: 18 }
    ],

    "logo-anim-basic": [
        { key: "sound", type: "toggle", label: { el: "Sound Design", en: "Sound Design" }, price: 48 },
        { key: "variations", type: "stepper", label: { el: "Επιπλέον Εκδοχές", en: "Extra Variations" }, min: 0, max: 3, default: 0, pricePerUnit: 60 }
    ],

    "logo-anim-advanced": [
        { key: "sound", type: "toggle", label: { el: "Sound Design", en: "Sound Design" }, price: 60 },
        { key: "variations", type: "stepper", label: { el: "Επιπλέον Εκδοχές", en: "Extra Variations" }, min: 0, max: 3, default: 0, pricePerUnit: 96 }
    ],

    "google-ads": [
        { key: "months", type: "stepper", role: "multiplier", label: { el: "Διάρκεια σε Μήνες", en: "Duration in Months" }, min: 1, max: 12, default: 1, pricePerUnit: 0 },
        { key: "campaigns", type: "stepper", label: { el: "Επιπλέον Καμπάνιες", en: "Extra Campaigns" }, min: 0, max: 5, default: 0, pricePerUnit: 96 }
    ],

    "meta-ads-setup": [
        { key: "campaigns", type: "stepper", role: "multiplier", label: { el: "Αριθμός Καμπανιών", en: "Number of Campaigns" }, min: 1, max: 10, default: 1, pricePerUnit: 0 },
        { key: "videoCreative", type: "toggle", label: { el: "Custom Video Creative αντί Static", en: "Custom Video Creative instead of Static" }, price: 120 }
    ],

    "meta-ads-optimization": [
        { key: "months", type: "stepper", role: "multiplier", label: { el: "Διάρκεια σε Μήνες", en: "Duration in Months" }, min: 1, max: 12, default: 1, pricePerUnit: 0 },
        { key: "weeklyreport", type: "toggle", label: { el: "Εβδομαδιαία Αναφορά Απόδοσης", en: "Weekly Performance Report" }, price: 36 }
    ],

    "static-creative": [
        { key: "quantity", type: "stepper", role: "multiplier", label: { el: "Αριθμός Creatives", en: "Number of Creatives" }, min: 1, max: 20, default: 1, pricePerUnit: 0 }
    ],

    "carousel-design": [
        { key: "quantity", type: "stepper", role: "multiplier", label: { el: "Αριθμός Carousels", en: "Number of Carousels" }, min: 1, max: 10, default: 1, pricePerUnit: 0 }
    ],

    "motion-video-ads": [
        { key: "quantity", type: "stepper", role: "multiplier", label: { el: "Αριθμός Videos", en: "Number of Videos" }, min: 1, max: 10, default: 1, pricePerUnit: 0 },
        { key: "seconds", type: "stepper", label: { el: "Επιπλέον Δευτερόλεπτα", en: "Extra Seconds" }, min: 0, max: 285, step: 15, default: 0, pricePerUnit: 6 }
    ],

    "blog-single": [
        { key: "articles", type: "stepper", role: "multiplier", label: { el: "Αριθμός Άρθρων", en: "Number of Articles" }, min: 1, max: 20, default: 1, pricePerUnit: 0 },
        { key: "extended", type: "toggle", label: { el: "Εκτενές Άρθρο (1500+ λέξεις)", en: "Extended Article (1500+ words)" }, price: 24 }
    ],

    "blog-pack": [
        { key: "months", type: "stepper", role: "multiplier", label: { el: "Διάρκεια σε Μήνες", en: "Duration in Months" }, min: 1, max: 12, default: 1, pricePerUnit: 0 },
        { key: "extraarticle", type: "toggle", label: { el: "Extra Άρθρο τον Μήνα", en: "Extra Article per Month" }, price: 48 }
    ],

    "content-population": [
        { key: "pages", type: "stepper", label: { el: "Επιπλέον Σελίδες", en: "Extra Pages" }, min: 0, max: 20, default: 0, pricePerUnit: 36 },
        { key: "translation", type: "toggle", label: { el: "Μετάφραση Περιεχομένου", en: "Content Translation" }, price: 180 }
    ],

    "website-management": [
        { key: "months", type: "stepper", role: "multiplier", label: { el: "Διάρκεια σε Μήνες", en: "Duration in Months" }, min: 1, max: 12, default: 1, pricePerUnit: 0 },
        { key: "extraarticles", type: "toggle", label: { el: "Επιπλέον Άρθρα / μήνα", en: "Extra Articles / month" }, price: 60 }
    ],

    "ecommerce-management": [
        { key: "months", type: "stepper", role: "multiplier", label: { el: "Διάρκεια σε Μήνες", en: "Duration in Months" }, min: 1, max: 12, default: 1, pricePerUnit: 0 },
        { key: "productBlocks", type: "stepper", label: { el: "Καταχώρηση Προϊόντων από εμάς (ανά 50)", en: "Product Data Entry by Us (per 50)" }, min: 0, max: 10, default: 0, pricePerUnit: 96 }
    ]
};
