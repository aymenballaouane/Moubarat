# CRM Moubarat en arabe — traductions à faire relire

*Document produit par `pnpm --filter @moubarat/crm traductions:relire` (ne pas modifier à la main : il est régénéré). 922 textes.*

Toutes les traductions arabes du CRM ont été rédigées par Claude (choix d’Aymen du 15/11/2026) : **aucune n’a été relue par un
arabophone**. Elles sont affichées telles quelles aux postes réglés en arabe. Merci de les relire en pensant à un gérant ou un
réceptionniste algérien devant son écran : arabe standard simple, compris de tous, sans tournure littéraire.

**Comment corriger.** Écrire la bonne traduction dans la colonne « Correction » (laisser vide si c’est juste), puis renvoyer le
document. Les valeurs entre accolades (`{n}`, `{date}`, `{1}`…) sont remplacées à l’affichage par un nombre, une date, un
nom : elles doivent rester dans la traduction, telles quelles, placées où la phrase arabe le veut. Les chiffres restent 0-9.
Une traduction corrigée passe du bloc « textes_provisoires » au bloc « textes » de `apps/crm/src/i18n/fr-ar.json` (ou
`fr-ar-serveur.json` pour les messages du serveur) et disparaît de cette liste.

## 1. Choix de vocabulaire à trancher d’abord

Chacun revient dans de nombreux textes : une correction ici sera reportée partout.

| Français | Choix provisoire | Où | Correction |
|---|---|---|---|
| Réservé · Honoré · Payé · No-show · Annulé (statuts) | محجوز · حاضر · مدفوع · غائب · ملغى | Les cinq statuts d’une réservation, partout dans le CRM. | |
| séance (d’un abonnement) | حصة | Abonnements, Réservations, Dashboard. | |
| comptoir (réservation prise sur place) | الشباك | Source d’une réservation ; étiquette courte « شباك » dans le Planning. | |
| App Moubarat / Moubarat (source) | تطبيق مبارات / مبارات | Les deux formes coexistent selon l’écran — en garder une ? | |
| Engagé (montant attendu) | مُلتزَم به | Réservations et Dashboard. | |
| Perdu no-show / Perdu annulations | ضائع (غيابات) / ضائع (إلغاءات) | Réservations. | |
| Réessayer (bouton) | أعيدوا المحاولة | Forme verbale au pluriel plutôt que le nom « إعادة المحاولة ». | |
| Moubarat (nom de marque) | مبارات | Translittération retenue partout. | |
| gérant | مسيّر | « Un compte gérant actif » ; le rôle « Manager » est « المدير ». | |
| bandes tarifaires (heures pleines…) | فترات سعرية | Écran Centre, tarifs. | |
| Env. (intérieur / extérieur) | داخلي/خارجي | En-tête de colonne, écran Centre. | |
| motif (le créneau qui revient chaque semaine) | التوقيت الأسبوعي | Messages d’erreur des abonnements. | |
| centre publié (ACTIVE) | منشور | Messages d’erreur et bandeaux. | |
| « … {1} jours à l’avance » | يومًا | Juste de 11 à 99 jours (la limite actuelle est 60). | |
| « Réessayez dans {1} min » | بعد {1} د | Abréviation pour éviter l’accord de « دقيقة ». | |
| Vous / impératifs | أنتم — اختاروا، أدخلوا، أعيدوا المحاولة | Le CRM vouvoie ; l’arabe s’adresse au pluriel. Garder ? | |

## 2. Textes des écrans

### Connexion

| Français | Arabe (provisoire) | Correction |
|---|---|---|
| Espace centre | فضاء المركز | |
| Connexion… | جارٍ الدخول… | |
| Se connecter | تسجيل الدخول | |
| Vous êtes un centre ? Faire une demande | هل أنتم مركز رياضي؟ قدّموا طلبًا | |

### Demande de référencement

| Français | Arabe (provisoire) | Correction |
|---|---|---|
| Demande reçue | تم استلام الطلب | |
| Merci. Nous étudions votre demande et revenons vers vous très bientôt, au téléphone ou par email. | شكرًا. ندرس طلبكم ونعاود الاتصال بكم قريبًا جدًا، عبر الهاتف أو البريد الإلكتروني. | |
| Retour à la connexion | العودة إلى تسجيل الدخول | |
| Référencer mon centre | تسجيل مركزي | |
| Vous gérez un centre sportif ? Dites-nous qui vous êtes : nous étudions chaque demande et vous recontactons. | تسيّرون مركزًا رياضيًا؟ عرّفونا بأنفسكم: ندرس كل طلب ونعاود الاتصال بكم. | |
| Nom du centre | اسم المركز | |
| Wilaya | الولاية | |
| Nombre de terrains (optionnel) | عدد الملاعب (اختياري) | |
| Sports pratiqués | الرياضات الممارسة | |
| Votre nom | اسمكم | |
| Message (optionnel) | رسالة (اختياري) | |
| J’accepte d’être recontacté au sujet de cette demande, et que mes coordonnées soient conservées à cette fin. | أوافق على أن يُعاد الاتصال بي بخصوص هذا الطلب، وعلى حفظ معلوماتي لهذا الغرض. | |
| Envoyer ma demande | إرسال طلبي | |

### Conditions d’utilisation

| Français | Arabe (provisoire) | Correction |
|---|---|---|
| Avant de continuer | قبل المتابعة | |
| Moubarat a besoin de votre accord sur ses conditions d’utilisation et sa politique de confidentialité pour que ce compte continue d’accéder au CRM. | تحتاج مبارات إلى موافقتكم على شروط الاستخدام وسياسة الخصوصية حتى يواصل هذا الحساب الوصول إلى نظام التسيير. | |
| Les documents ci-dessous ne sont disponibles qu’en français. | الوثائق أدناه متوفرة باللغة الفرنسية فقط. | |
| J’ai lu et j’accepte les conditions générales d’utilisation et la politique de confidentialité. | قرأت الشروط العامة للاستخدام وسياسة الخصوصية وأوافق عليهما. | |
| Continuer | متابعة | |

### Cadre (en-tête, menu)

| Français | Arabe (provisoire) | Correction |
|---|---|---|
| Serveur injoignable | تعذّر الاتصال بالخادم | |
| Le serveur de Moubarat ne répond pas pour l’instant (mise à jour ou panne). Votre session est gardée : nouvel essai automatique toutes les 5 secondes. | خادم مبارات لا يستجيب حاليًا (تحديث أو عطل). جلستكم محفوظة: محاولة جديدة تلقائيًا كل 5 ثوانٍ. | |
| Mode clair | الوضع الفاتح | |
| Mode sombre | الوضع الداكن | |
| Aide | مساعدة | |
| Connecté : {name} | متصل: {name} | |
| Mon compte | حسابي | |
| Déconnexion | تسجيل الخروج | |

### Bandeaux

| Français | Arabe (provisoire) | Correction |
|---|---|---|
| Ouvrir l’écran Centre | فتح شاشة المركز | |
| Centre suspendu par Moubarat — il n’apparaît plus dans l’app joueur. Contactez Moubarat (bouton Aide). | المركز موقوف من طرف مبارات — لم يعد يظهر في تطبيق اللاعبين. اتصلوا بمبارات (زر المساعدة). | |
| Ce centre n’a pas été retenu par Moubarat. Contactez Moubarat (bouton Aide). | لم يتم قبول هذا المركز من طرف مبارات. اتصلوا بمبارات (زر المساعدة). | |
| Votre centre a disparu de l’app joueur — il manque : {liste}. | اختفى مركزكم من تطبيق اللاعبين — ينقص: {liste}. | |
| Votre centre n’est pas encore publié dans l’app joueur. Avant de le signaler prêt, il manque : {liste}. | مركزكم غير منشور بعد في تطبيق اللاعبين. قبل الإشعار بجاهزيته، ينقص: {liste}. | |
| Recommandé : {liste}. | يُنصح بـ: {liste}. | |
| Votre centre est complet et attend la validation de Moubarat. | مركزكم مكتمل وينتظر موافقة مبارات. | |
| Signalé prêt {quand}. | تم الإشعار بالجاهزية يوم {quand}. | |
| Envoi… | جارٍ الإرسال… | |
| Signaler à nouveau | الإشعار من جديد | |
| Signaler que c’est prêt | الإشعار بالجاهزية | |
| Abonnement Moubarat en retard de paiement — contactez Moubarat pour régulariser. | اشتراك مبارات متأخر الدفع — اتصلوا بمبارات لتسوية الوضعية. | |
| Votre mois d’essai Moubarat se termine le {date} — contactez Moubarat pour continuer. | ينتهي شهركم التجريبي مع مبارات يوم {date} — اتصلوا بمبارات للمواصلة. | |
| Abonnement Moubarat à renouveler avant le {date}. | يجب تجديد اشتراك مبارات قبل {date}. | |
| tarif manquant : {terrains} | سعر ناقص: {terrains} | |

### Aide

| Français | Arabe (provisoire) | Correction |
|---|---|---|
| Aide et support | المساعدة والدعم | |
| Besoin d’aide ? | تحتاجون مساعدة؟ | |
| Un souci avec le CRM, un accès, une réservation ? Écrivez-nous ou appelez-nous. | مشكلة في نظام التسيير أو في الدخول أو في حجز؟ راسلونا أو اتصلوا بنا. | |
| Liste de démarrage du centre | قائمة انطلاق المركز | |
| Fait | تم | |
| À faire | للإنجاز | |
| Conseillé | مُستحسن | |
| Votre centre est publié dans l’app joueur. | مركزكم منشور في تطبيق اللاعبين. | |
| Votre centre est publié, mais un point manque : il n’apparaît plus dans l’app joueur tant qu’il n’est pas réglé. | مركزكم منشور، لكن ينقصه عنصر: لن يظهر في تطبيق اللاعبين حتى تتم تسويته. | |
| Tout est prêt : signalez-le à Moubarat depuis le bandeau en haut de l’écran. | كل شيء جاهز: أشعِروا مبارات من الشريط في أعلى الشاشة. | |
| Les points « À faire » sont nécessaires avant la publication dans l’app joueur. | العناصر «للإنجاز» ضرورية قبل النشر في تطبيق اللاعبين. | |
| Premiers pas | الخطوات الأولى | |

### Mon compte

| Français | Arabe (provisoire) | Correction |
|---|---|---|
| Mot de passe modifié. | تم تغيير كلمة المرور. | |
| Mot de passe modifié — 1 autre session fermée. | تم تغيير كلمة المرور — أُغلقت جلسة أخرى. | |
| Mot de passe modifié — {n} autres sessions fermées. | تم تغيير كلمة المرور — عدد الجلسات الأخرى المغلقة: {n}. | |
| Connecté en tant que | متصل باسم | |
| Changer le mot de passe ferme les autres sessions ouvertes avec ce compte (autre poste, autre navigateur). | تغيير كلمة المرور يغلق الجلسات الأخرى المفتوحة بهذا الحساب (جهاز آخر، متصفح آخر). | |
| Mot de passe actuel | كلمة المرور الحالية | |
| Nouveau mot de passe ({n} signes au moins) | كلمة مرور جديدة (عدد الرموز: {n} على الأقل) | |
| Encore {n} signes. | عدد الرموز الناقصة: {n}. | |
| Encore 1 signe. | بقي رمز واحد. | |
| Confirmer le nouveau mot de passe | تأكيد كلمة المرور الجديدة | |
| Les deux saisies ne correspondent pas. | الإدخالان غير متطابقين. | |
| Enregistrement… | جارٍ الحفظ… | |
| Changer le mot de passe | تغيير كلمة المرور | |

### Identifiants générés

| Français | Arabe (provisoire) | Correction |
|---|---|---|
| Ce mot de passe ne sera plus jamais affiché. Notez-le ou copiez-le maintenant. | لن تظهر كلمة المرور هذه مرة أخرى. دوّنوها أو انسخوها الآن. | |
| Email | البريد الإلكتروني | |
| Mot de passe | كلمة المرور | |
| Copie impossible depuis ce navigateur — sélectionnez le mot de passe et copiez-le à la main. | يتعذّر النسخ من هذا المتصفح — حدّدوا كلمة المرور وانسخوها يدويًا. | |
| Copié | تم النسخ | |
| Copier les identifiants | نسخ بيانات الدخول | |
| J’ai noté le mot de passe | دوّنت كلمة المرور | |

### Dashboard

| Français | Arabe (provisoire) | Correction |
|---|---|---|
| Ouvert {plage} | مفتوح {plage} | |
| Fermé ce jour-là | مغلق في هذا اليوم | |
| {n} réservations passées non clôturées ({jours} derniers jours) | حجوزات سابقة دون حالة نهائية: {n} (آخر {jours} يومًا) | |
| {n} réservation passée non clôturée ({jours} derniers jours) | {n} حجز سابق دون حالة نهائية (آخر {jours} يومًا) | |
| La plus ancienne : {quoi}. Marquez chaque réservation Honorée, Payée ou No-show : sinon le chiffre d’affaires et les no-shows sont faux. | الأقدم: {quoi}. سجّلوا كل حجز «حاضر» أو «مدفوع» أو «غائب»: وإلا سيكون رقم الأعمال وعدد الغيابات خاطئين. | |
| Ouvrir | فتح | |
| {n} réservations passées honorées, jamais encaissées | حجوزات سابقة حاضرة لم تُحصَّل أبدًا: {n} | |
| {n} réservation passée honorée, jamais encaissée | {n} حجز سابق حاضر لم يُحصَّل أبدًا | |
| La plus ancienne : {quoi}. À marquer « Payée » si le client a réglé. | الأقدم: {quoi}. يُسجَّل «مدفوع» إن دفع الزبون. | |
| À marquer « Payée » si le client a réglé. | يُسجَّل «مدفوع» إن دفع الزبون. | |
| {n} séances d’abonnés passées non clôturées | حصص مشتركين سابقة دون حالة نهائية: {n} | |
| {n} séance d’abonné passée non clôturée | {n} حصة مشترك سابقة دون حالة نهائية | |
| La plus ancienne : {quoi}. Marquez-la Payée, Honorée ou No-show dans Réservations. | الأقدم: {quoi}. سجّلوها «مدفوع» أو «حاضر» أو «غائب» في الحجوزات. | |
| Score partiel — fiabilité capitaine non disponible pour votre rôle. | نتيجة جزئية — موثوقية القائد غير متاحة لدوركم. | |
| Contacter | اتصال | |
| Téléphone à vérifier — {quoi} | هاتف للتحقق — {quoi} | |
| En attente | في الانتظار | |
| Le créneau est bloqué en attendant votre confirmation — cliquez pour ouvrir. | التوقيت محجوز في انتظار تأكيدكم — انقروا للفتح. | |
| {n} réservations honorées non encaissées | حجوزات حاضرة غير محصَّلة: {n} | |
| {n} réservation honorée non encaissée | {n} حجز حاضر غير محصَّل | |
| À encaisser avant la clôture de caisse. | للتحصيل قبل إغلاق الصندوق. | |
| Chargement du tableau de bord… | جارٍ تحميل لوحة القيادة… | |
| Encaissé | محصَّل | |
| Engagé | مُلتزَم به | |
| Sur les heures d'ouverture réelles | على أساس أوقات العمل الفعلية | |
| Remplissage · réel | نسبة الإشغال · فعلية | |
| Réservations | الحجوزات | |
| Part Moubarat | حصة مبارات | |
| À faire / à surveiller — chaque ligne est cliquable et dit pourquoi | للإنجاز / للمتابعة — كل سطر قابل للنقر ويوضّح السبب | |
| Rien à surveiller — journée saine. | لا شيء للمتابعة — يوم سليم. | |
| Prochaines heures | الساعات القادمة | |
| Plus rien au planning — journée terminée ou libre. | لا شيء آخر في جدول الحجوزات — يوم منتهٍ أو فارغ. | |
| = {jour} | مثل {jour} | |
| {n} DA | {n} دج | |
| {n} pts | {n} نقطة | |
| {n} pt | {n} نقطة | |
| {valeur} vs {jour} | {valeur} مقارنة بـ {jour} | |
| Début dans moins de 2 h, incomplet | يبدأ خلال أقل من ساعتين، غير مكتمل | |
| Début dans moins de 6 h, incomplet | يبدأ خلال أقل من 6 ساعات، غير مكتمل | |
| Effectif {effectif} | العدد {effectif} | |
| Fiabilité du capitaine {score}/100 | موثوقية القائد {score}/100 | |
| Fiabilité moyenne des inscrits {score}/100 | متوسط موثوقية المسجَّلين {score}/100 | |
| {n} inscrit(s) non confirmé(s) | مسجَّلون غير مؤكَّدين: {n} | |

### Planning

| Français | Arabe (provisoire) | Correction |
|---|---|---|
| Indiquez un nom pour la réservation. | أدخلوا اسمًا للحجز. | |
| Choisissez le format de la réservation. | اختاروا صيغة الحجز. | |
| Réservation créée. Ce numéro est celui d’un joueur Moubarat : il est prévenu et doit confirmer. | تم إنشاء الحجز. هذا الرقم يخص لاعبًا في مبارات: تم إعلامه وعليه التأكيد. | |
| Réservation créée. | تم إنشاء الحجز. | |
| Ce créneau est fermé ({motif}). | هذا التوقيت مغلق ({motif}). | |
| Ce créneau est fermé. | هذا التوقيت مغلق. | |
| Vue semaine — à venir | عرض الأسبوع — قريبًا | |
| Semaine | أسبوع | |
| Aujourd'hui | اليوم | |
| Aller à une date | الانتقال إلى تاريخ | |
| Le planning se relit seul toutes les 30 secondes | يُحدَّث جدول الحجوزات تلقائيًا كل 30 ثانية | |
| À jour · {heure} | محدَّث · {heure} | |
| Tous | الكل | |
| Étendu | موسَّع | |
| Compact | مضغوط | |
| Prochaine dispo | أقرب توقيت متاح | |
| Recherche… | جارٍ البحث… | |
| Chercher | بحث | |
| Prochain créneau : | التوقيت التالي: | |
| dès {montant} en {format} | ابتداءً من {montant} بصيغة {format} | |
| Réserver | حجز | |
| Rien sous 8 jours pour ces critères. | لا يوجد أي توقيت خلال 8 أيام بهذه المعايير. | |
| Chargement du planning… | جارٍ تحميل جدول الحجوزات… | |
| Le centre est fermé ce jour-là. | المركز مغلق في هذا اليوم. | |
| {h}h | {h}:00 | |
| {terrain} · {heure} — libre. Votre rôle ({role}) permet de consulter le planning, pas de créer une réservation. | {terrain} · {heure} — متاح. دوركم ({role}) يسمح بالاطلاع على جدول الحجوزات، لا بإنشاء حجز. | |
| Indisponible | غير متاح | |
| dès {montant} | ابتداءً من {montant} | |
| Réservé | محجوز | |
| Match | المباراة | |
| Tél. à vérifier | هاتف للتحقق | |
| Honoré / Payé | حاضر / مدفوع | |
| No-show | غائب | |
| Ligne rouge · maintenant | الخط الأحمر · الآن | |
| libre | متاح | |
| Au nom de qui ? | باسم من؟ | |
| Téléphone | الهاتف | |
| Canal | القناة | |
| Comptoir | الشباك | |
| Format de la réservation | صيغة الحجز | |
| Calcul du devis… | جارٍ حساب السعر… | |
| Indisponible sur ce créneau (conflit, fermeture ou hors horaires). | غير متاح في هذا التوقيت (تعارض أو إغلاق أو خارج أوقات العمل). | |
| Le prix dépend du format — choisissez-en un. | السعر يتوقف على الصيغة — اختاروا واحدة. | |
| Tarif calculé ({format}) : | السعر المحسوب ({format}): | |
| Tarif calculé : | السعر المحسوب: | |
| Créer la réservation | إنشاء الحجز | |
| Cliquez sur une case libre pour créer une réservation ; la fiche complète d’une réservation est dans Réservations. Pour changer son terrain, son heure ou sa durée : bouton « Modifier » de sa fiche. | انقروا على خانة فارغة لإنشاء حجز؛ البطاقة الكاملة للحجز موجودة في الحجوزات. لتغيير ملعبه أو ساعته أو مدته: زر «تعديل» في بطاقته. | |

### Réservations

| Français | Arabe (provisoire) | Correction |
|---|---|---|
| personne d’autre n’était inscrit | لم يكن أي لاعب آخر مسجَّلًا | |
| 1 joueur prévenu | تم إعلام لاعب واحد | |
| {n} joueurs prévenus | عدد اللاعبين الذين تم إعلامهم: {n} | |
| Réservation annulée — match « {titre} » annulé, {qui}. | تم إلغاء الحجز — أُلغيت المباراة «{titre}»، {qui}. | |
| Réservation annulée — le client est prévenu dans l’app. | تم إلغاء الحجز — تم إعلام الزبون في التطبيق. | |
| Tél. · vérifiée | الهاتف · مؤكَّد | |
| Tél. · à vérifier | الهاتف · للتحقق | |
| {montant} — encaissé | {montant} — محصَّل | |
| 0 DA — no-show ({montant} perdus) | 0 دج — غائب ({montant} ضائعة) | |
| 0 DA — annulée | 0 دج — ملغى | |
| 0 DA sur {montant} — à encaisser | 0 دج من {montant} — للتحصيل | |
| Téléphone (vérifiée) | الهاتف (مؤكَّد) | |
| Téléphone (à vérifier) | الهاتف (للتحقق) | |
| Match créé, non modifiable — annulez pour libérer le créneau (le match s’annule avec elle, les inscrits sont prévenus) | تم إنشاء مباراة، لا يمكن التعديل — ألغوا الحجز لتحرير التوقيت (تُلغى المباراة معه ويتم إعلام المسجَّلين) | |
| Origine | المصدر | |
| Joueur Moubarat | لاعب مبارات | |
| Terrain · créneau | الملعب · التوقيت | |
| ({n} min) | ({n} دقيقة) | |
| Montant · encaissement | المبلغ · التحصيل | |
| {joined}/{capacity} inscrits | المسجَّلون: {joined}/{capacity} | |
| Joueurs (profils Moubarat) | اللاعبون (حسابات مبارات) | |
| Joueur absent ? | لاعب غائب؟ | |
| {nom} · absent | {nom} · غائب | |
| « {titre} » annulé — la réservation aussi ; les inscrits ont été prévenus dans l’app | أُلغيت المباراة «{titre}» — والحجز أيضًا؛ تم إعلام المسجَّلين في التطبيق | |
| « {titre} » annulé par son organisateur — la réservation reste valable et se gère comme une réservation ordinaire | ألغى المنظّم المباراة «{titre}» — يبقى الحجز صالحًا ويُسيَّر كحجز عادي | |
| Profil | الحساب | |
| Compte App Moubarat — fiche dans Clients | حساب في تطبيق مبارات — بطاقته في الزبائن | |
| Modifier | تعديل | |
| Confirmer la réservation téléphonique | تأكيد الحجز الهاتفي | |
| Marquer honorée | تسجيل الحضور | |
| Marquer no-show | تسجيل الغياب | |
| Annuler le no-show | إلغاء الغياب | |
| Corriger le statut | تصحيح الحالة | |
| Marquer payée | تسجيل الدفع | |
| Avec le module Caisse, « Marquer payée » propose d’encaisser le même montant dans la caisse du jour ; sans lui, « Payée » ne touche pas à la caisse. | مع وحدة الصندوق، يقترح «تسجيل الدفع» تحصيل المبلغ نفسه في صندوق اليوم؛ بدونها، لا يمسّ «مدفوع» الصندوق. | |
| « Honorée » et « No-show » se posent une fois le créneau commencé, à partir de {heure}. | «حاضر» و«غائب» يُسجَّلان بعد بدء التوقيت، ابتداءً من {heure}. | |
| Ouvrir dans le planning | فتح في جدول الحجوزات | |
| Prix de la séance | سعر الحصة | |
| Sans prix — à fixer dans Abonnements | بدون سعر — يُحدَّد في الاشتراكات | |
| « Honorée » et « No-show » se posent une fois la séance commencée, à partir de {heure}. | «حاضر» و«غائب» يُسجَّلان بعد بدء الحصة، ابتداءً من {heure}. | |
| Fixez le prix par séance dans l’écran Abonnements pour suivre ses paiements. | حدِّدوا سعر الحصة في شاشة الاشتراكات لمتابعة مدفوعاتها. | |
| Réservation téléphonique confirmée. | تم تأكيد الحجز الهاتفي. | |
| Séance payée et encaissée en caisse. | تم تسجيل دفع الحصة وتحصيلها في الصندوق. | |
| Séance payée — rien n’a été encaissé : la caisse n’est pas ouverte. | تم تسجيل دفع الحصة — لم يُحصَّل أي مبلغ: الصندوق غير مفتوح. | |
| Séance marquée payée. | تم تسجيل دفع الحصة. | |
| Séance marquée honorée. | تم تسجيل الحضور في الحصة. | |
| Séance marquée no-show. | تم تسجيل الغياب في الحصة. | |
| Statut de la séance corrigé. | تم تصحيح حالة الحصة. | |
| Réservation payée et encaissée en caisse. | تم تسجيل دفع الحجز وتحصيله في الصندوق. | |
| Réservation payée — rien n’a été encaissé : la caisse n’est pas ouverte. | تم تسجيل دفع الحجز — لم يُحصَّل أي مبلغ: الصندوق غير مفتوح. | |
| No-show annulé — l’absence du joueur est effacée. | تم إلغاء الغياب — مُحي غياب اللاعب. | |
| No-show annulé. | تم إلغاء الغياب. | |
| Statut corrigé : Honorée. | تم تصحيح الحالة: حاضر. | |
| Statut corrigé : Réservée. | تم تصحيح الحالة: محجوز. | |
| {nom} était déjà déclaré absent. | {nom} مسجَّل غائبًا من قبل. | |
| Absence enregistrée — {nom} est maintenant restreint (il ne peut plus rejoindre de match ni réserver pour un temps). | تم تسجيل الغياب — {nom} مقيَّد الآن (لا يمكنه الانضمام إلى مباراة ولا الحجز لمدة معيّنة). | |
| Absence enregistrée. | تم تسجيل الغياب. | |
| Réservation modifiée. | تم تعديل الحجز. | |
| La liste se relit seule toutes les 30 secondes | تُحدَّث القائمة تلقائيًا كل 30 ثانية | |
| Le résumé de la journée, dans l'ordre chronologique. Cliquez sur une réservation pour ouvrir sa fiche complète — c'est cette liste que la clôture de caisse valide chaque soir. | ملخص اليوم بالترتيب الزمني. انقروا على حجز لفتح بطاقته الكاملة — هذه القائمة هي التي يصادق عليها إغلاق الصندوق كل مساء. | |
| Retrouver une réservation (référence, nom, téléphone)… | البحث عن حجز (المرجع، الاسم، الهاتف)… | |
| Retrouver une réservation par référence, nom ou téléphone | البحث عن حجز بالمرجع أو الاسم أو الهاتف | |
| Aucune réservation ne correspond à « {recherche} ». | لا يوجد حجز يطابق «{recherche}». | |
| Ouvrir sa fiche | فتح البطاقة | |
| Chargement des réservations… | جارٍ تحميل الحجوزات… | |
| Perdu annulations | ضائع (إلغاءات) | |
| Perdu no-show | ضائع (غيابات) | |
| Aucune réservation ce jour-là. | لا توجد حجوزات في هذا اليوم. | |
| séance du {date} | حصة يوم {date} | |
| Marquer cette réservation no-show ? | تسجيل الغياب لهذا الحجز؟ | |
| « {label} » sera marquée no-show : {montant} comptés perdus. | سيُسجَّل «{label}» غائبًا: يُحتسب {montant} ضائعًا. | |
| C’est une absence pour le joueur | هذا غياب يُحتسب على اللاعب | |
| : deux absences déclenchent une restriction (7 jours, puis 30 jours, puis blocage). Un manager pourra corriger en cas d’erreur. | : غيابان يؤديان إلى تقييد (7 أيام، ثم 30 يومًا، ثم حظر). يمكن للمدير التصحيح في حالة الخطأ. | |
| Un manager pourra corriger en cas d’erreur. | يمكن للمدير التصحيح في حالة الخطأ. | |
| Déclarer ce joueur absent ? | تسجيل غياب هذا اللاعب؟ | |
| « {nom} » sera déclaré absent du match « {match} ». | سيُسجَّل «{nom}» غائبًا عن المباراة «{match}». | |
| Une absence compte pour la fiabilité du joueur | الغياب يُحتسب في موثوقية اللاعب | |
| : deux absences déclenchent une restriction (7 jours, puis 30 jours, puis blocage levé par le support Moubarat). Cette déclaration ne s’annule pas ici : en cas d’erreur, le support peut lever la restriction. | : غيابان يؤديان إلى تقييد (7 أيام، ثم 30 يومًا، ثم حظر يرفعه دعم مبارات). لا يمكن إلغاء هذا التصريح هنا: في حالة الخطأ، يمكن للدعم رفع التقييد. | |
| Déclarer absent | تسجيل غياب اللاعب | |
| Annuler ce no-show ? | إلغاء هذا الغياب؟ | |
| « {label} » redevient « Réservée ». Si le joueur avait été compté absent, son absence est effacée et la restriction qu’elle avait déclenchée est levée. | «{label}» يعود «محجوزًا». إذا كان اللاعب قد احتُسب غائبًا، يُمحى غيابه ويُرفع التقييد الذي تسبّب فيه. | |
| Corriger ce statut ? | تصحيح هذه الحالة؟ | |
| « {label} » redevient « Honorée » (non payée). À utiliser seulement pour une erreur de saisie ; la correction est tracée au Journal. La Caisse n’est pas modifiée. | «{label}» يعود «حاضرًا» (غير مدفوع). يُستعمل فقط لتصحيح خطأ في الإدخال؛ يُسجَّل التصحيح في السجل. لا يتغيّر الصندوق. | |
| « {label} » redevient « Réservée » (non payée). À utiliser seulement pour une erreur de saisie ; la correction est tracée au Journal. La Caisse n’est pas modifiée. | «{label}» يعود «محجوزًا» (غير مدفوع). يُستعمل فقط لتصحيح خطأ في الإدخال؛ يُسجَّل التصحيح في السجل. لا يتغيّر الصندوق. | |
| « {label} » redevient « Réservée ». À utiliser seulement pour une erreur de saisie ; la correction est tracée au Journal. La Caisse n’est pas modifiée. | «{label}» يعود «محجوزًا». يُستعمل فقط لتصحيح خطأ في الإدخال؛ يُسجَّل التصحيح في السجل. لا يتغيّر الصندوق. | |
| Marquer payée ? | تسجيل الدفع؟ | |
| « {label} » — {montant}. | «{label}» — {montant}. | |
| Vérification de la caisse du jour… | جارٍ التحقق من صندوق اليوم… | |
| Encaisser aussi {montant} dans la caisse du jour | تحصيل {montant} أيضًا في صندوق اليوم | |
| La caisse du jour n’est pas ouverte : rien ne sera encaissé. Pensez à saisir cet encaissement dans Caisse. | صندوق اليوم غير مفتوح: لن يُحصَّل أي مبلغ. تذكّروا تسجيل هذا التحصيل في الصندوق. | |
| Annuler cette réservation ? | إلغاء هذا الحجز؟ | |
| « {label} » sera marquée annulée. Le créneau redevient disponible. | سيُسجَّل «{label}» ملغى. يعود التوقيت متاحًا. | |
| Le match « {titre} » ({n} inscrits) sera annulé avec elle | ستُلغى المباراة «{titre}» (عدد المسجَّلين: {n}) مع الحجز | |
| Le match « {titre} » ({n} inscrit) sera annulé avec elle | ستُلغى المباراة «{titre}» (عدد المسجَّلين: {n}) مع الحجز | |
| — les joueurs inscrits sont prévenus dans l’app. | — يتم إعلام اللاعبين المسجَّلين في التطبيق. | |
| Le client sera prévenu dans l’app. | سيتم إعلام الزبون في التطبيق. | |
| Motif — obligatoire, ça compte pour le CA perdu et la fiabilité du client | السبب — إلزامي، يُحتسب في رقم الأعمال الضائع وفي موثوقية الزبون | |
| Motif d’annulation | سبب الإلغاء | |
| Le client a annulé | ألغى الزبون | |
| Erreur de saisie du centre | خطأ في الإدخال من المركز | |
| Annuler la réservation | إلغاء الحجز | |
| Modifier la réservation | تعديل الحجز | |
| Nouveau prix : | السعر الجديد: | |
| — remise perdue sur ce créneau (code non éligible) | — يضيع التخفيض في هذا التوقيت (الرمز غير مؤهَّل) | |
| Modification… | جارٍ التعديل… | |
| Aucun résultat | لا توجد نتائج | |
| {n} résultats | عدد النتائج: {n} | |
| {n} résultat | عدد النتائج: {n} | |
| {label} affichés — affinez la recherche ou affichez plus | {label} (المعروضة) — دقّقوا البحث أو اعرضوا المزيد | |

### Abonnements

| Français | Arabe (provisoire) | Correction |
|---|---|---|
| Les abonnements se gèrent en Manager | تُسيَّر الاشتراكات من دور المدير | |
| Demandez à un manager du centre d'y accéder. | اطلبوا من مدير المركز الوصول إليها. | |
| Indiquez le prix d’une séance (un montant entier en DA). | أدخلوا سعر الحصة (مبلغ صحيح بالدينار). | |
| Abonnement créé. | تم إنشاء الاشتراك. | |
| Abonnement résilié. | تم فسخ الاشتراك. | |
| Prix par séance enregistré. | تم حفظ سعر الحصة. | |
| Un abonnement réserve le même créneau chaque semaine, d'une date à une autre, et s'affiche dans le planning. Chaque séance a son prix : elle se marque Payée, Honorée ou No-show dans Réservations et compte dans le chiffre d’affaires et la caisse. | يحجز الاشتراك نفس التوقيت كل أسبوع، من تاريخ إلى آخر، ويظهر في جدول الحجوزات. لكل حصة سعرها: تُسجَّل «مدفوع» أو «حاضر» أو «غائب» في الحجوزات وتُحتسب في رقم الأعمال والصندوق. | |
| Nom / entreprise | الاسم / المؤسسة | |
| Jour | يوم | |
| Heure | الساعة | |
| Durée | المدة | |
| {n} min | {n} دقيقة | |
| Terrain | الملعب | |
| Prix / séance (DA) | سعر الحصة (دج) | |
| Fin | النهاية | |
| Créer l'abonnement | إنشاء الاشتراك | |
| Abonnements actifs | الاشتراكات النشطة | |
| Réessayer | أعيدوا المحاولة | |
| Chargement des abonnements… | جارٍ تحميل الاشتراكات… | |
| Aucun abonnement actif. | لا يوجد اشتراك نشط. | |
| {montant} la séance | {montant} للحصة | |
| Sans prix — à fixer pour suivre ses paiements | بدون سعر — يجب تحديده لمتابعة مدفوعاته | |
| jusqu'au {date} | حتى {date} | |
| sans date de fin | بدون تاريخ نهاية | |
| Prix par séance de {nom} | سعر الحصة لـ {nom} | |
| Enregistrer | حفظ | |
| Annuler | إلغاء | |
| Actif | نشط | |
| Modifier le prix | تعديل السعر | |
| Fixer le prix | تحديد السعر | |
| Résilier | فسخ | |
| Changer le prix par séance ? | تغيير سعر الحصة؟ | |
| Vaut pour les séances pas encore marquées. Une séance déjà payée, honorée ou no-show garde son prix. | يسري على الحصص غير المسجَّلة بعد. الحصة المسجَّلة «مدفوع» أو «حاضر» أو «غائب» تحتفظ بسعرها. | |
| Enregistrer le prix | حفظ السعر | |
| Résilier cet abonnement ? | فسخ هذا الاشتراك؟ | |
| ses occurrences futures disparaîtront du planning. | ستختفي حصصه القادمة من جدول الحجوزات. | |
| L'historique passé est conservé. | تبقى الحصص السابقة محفوظة. | |

### Analytics

| Français | Arabe (provisoire) | Correction |
|---|---|---|
| Un export couvre 3 mois au plus. Pour une période plus longue, faites plusieurs exports. | يغطي التصدير 3 أشهر على الأكثر. لفترة أطول، قوموا بعدة عمليات تصدير. | |
| Analytics | التحليلات | |
| Vue d’ensemble | نظرة عامة | |
| Rapport du mois | تقرير الشهر | |
| Jour précédent | اليوم السابق | |
| Jour suivant | اليوم التالي | |
| Chargement des statistiques… | جارٍ تحميل الإحصائيات… | |
| Chiffre d'affaires — 7 derniers jours comparés aux 7 précédents · 30 jours comparés aux 30 précédents | رقم الأعمال — آخر 7 أيام مقارنة بالـ7 السابقة · آخر 30 يومًا مقارنة بالـ30 السابقة | |
| CA encaissé · aujourd’hui | رقم الأعمال المحصَّل · اليوم | |
| DA | دج | |
| CA · 7 jours (hebdo) | رقم الأعمال · 7 أيام (أسبوعي) | |
| CA · 30 jours (mensuel) | رقم الأعمال · 30 يومًا (شهري) | |
| CA perdu annulations · 7 j | رقم الأعمال الضائع بسبب الإلغاءات · 7 أيام | |
| CA perdu no-shows · 7 j | رقم الأعمال الضائع بسبب الغيابات · 7 أيام | |
| Taux de no-show · 7 j | نسبة الغياب · 7 أيام | |
| Taux de remplissage · 7 j | نسبة الإشغال · 7 أيام | |
| Panier moyen · 7 j | متوسط السلة · 7 أيام | |
| Tendance — CA encaissé · 14 derniers jours | المنحى — رقم الأعمال المحصَّل · آخر 14 يومًا | |
| Remplissage par terrain — {jour}, sur les heures réelles | نسبة الإشغال حسب الملعب — {jour}، على أوقات العمل الفعلية | |
| Chargement… | جارٍ التحميل… | |
| CA par terrain — 7 derniers jours | رقم الأعمال حسب الملعب — آخر 7 أيام | |
| CA | رقم الأعمال | |
| Occupation | نسبة الإشغال | |
| Revenu / h d'ouverture | الإيراد / ساعة عمل | |
| {montant} DA/h | {montant} دج/سا | |
| No-shows | الغيابات | |
| Sous-performe — créer une promotion ? | أداء ضعيف — إنشاء رمز ترويجي؟ | |
| Origine des réservations — 7 derniers jours | مصدر الحجوزات — آخر 7 أيام | |
| Export — preuve fiscale et sauvegarde manuelle | التصدير — إثبات جبائي ونسخة احتياطية يدوية | |
| Du | من | |
| Au | إلى | |
| Export… | جارٍ التصدير… | |
| Télécharger (.xlsx) | تنزيل (.xlsx) | |

### Analytics — rapport du mois

| Français | Arabe (provisoire) | Correction |
|---|---|---|
| Mois précédent | الشهر السابق | |
| Mois suivant | الشهر التالي | |
| Imprimer / PDF | طباعة / PDF | |
| Rapport du mois — {centre} | تقرير الشهر — {centre} | |
| (en cours) | (جارٍ) | |
| Comparé à {mois}. Chiffres réels du CRM, erreurs de saisie du centre exclues. | مقارنة بـ{mois}. أرقام فعلية من نظام التسيير، دون أخطاء الإدخال من المركز. | |
| Chargement du rapport… | جارٍ تحميل التقرير… | |
| Chiffre d’affaires encaissé | رقم الأعمال المحصَّل | |
| dont réservations venues de l’app Moubarat | منها حجوزات واردة من تطبيق مبارات | |
| {pct} % du chiffre encaissé | {pct} % من رقم الأعمال المحصَّل | |
| Réservations jouées (honorées ou payées) | الحجوزات المُنجزة (حاضر أو مدفوع) | |
| dont via l’app Moubarat | منها عبر تطبيق مبارات | |
| Remplissage des terrains | نسبة إشغال الملاعب | |
| {montant} perdus | خسارة {montant} | |
| {pct} % des réservations | {pct} % من الحجوزات | |
| Chiffre perdu sur annulations | رقم الأعمال الضائع بسبب الإلغاءات | |
| Encore à encaisser | المبلغ المتبقي للتحصيل | |
| Réservations du mois ni payées ni clôturées | حجوزات الشهر غير المدفوعة وغير المُقفلة | |
| Tout est clôturé | كل شيء مُقفل | |

### Clients

| Français | Arabe (provisoire) | Correction |
|---|---|---|
| Fermer l’historique | إغلاق تاريخ الحجوزات | |
| Voir l’historique des réservations | عرض تاريخ الحجوزات | |
| Nouveau | جديد | |
| Sans compte Moubarat : ses réservations au comptoir et par téléphone, regroupées par numéro | بدون حساب مبارات: حجوزاته في الشباك وعبر الهاتف، مجمّعة حسب الرقم | |
| Comptoir · téléphone | الشباك · الهاتف | |
| {n} résa | الحجوزات: {n} | |
| {n} résas | الحجوزات: {n} | |
| {n} honorée | الحضور: {n} | |
| {n} honorées | الحضور: {n} | |
| {n} annulée tôt | ملغاة مبكرًا: {n} | |
| {n} annulées tôt | ملغاة مبكرًا: {n} | |
| {n} tardive | ملغاة متأخرًا: {n} | |
| {n} tardives | ملغاة متأخرًا: {n} | |
| {n} no-show | الغياب: {n} | |
| Les clients qui ont réservé sur ce centre : joueurs de l'app Moubarat, et clients du comptoir ou du téléphone (regroupés par numéro — une réservation saisie sans numéro n'y figure pas). Fiabilité calculée sur leur historique réel. Cliquez sur une carte pour voir ses réservations. | الزبائن الذين حجزوا في هذا المركز: لاعبو تطبيق مبارات، وزبائن الشباك أو الهاتف (مجمّعون حسب الرقم — الحجز المُدخل بدون رقم لا يظهر هنا). الموثوقية محسوبة على تاريخهم الفعلي. انقروا على بطاقة لعرض حجوزاتها. | |
| Rechercher un client (nom ou téléphone)… | البحث عن زبون (الاسم أو الهاتف)… | |
| Rechercher un client par nom ou téléphone | البحث عن زبون بالاسم أو الهاتف | |
| Chargement des clients… | جارٍ تحميل الزبائن… | |
| Fiabilité pondérée + confiance — visible du centre uniquement | الموثوقية المرجّحة + الثقة — لا يراها إلا المركز | |
| Aucun client. | لا يوجد زبائن. | |
| Historique — {name} | تاريخ الحجوزات — {name} | |
| Chargement de l'historique… | جارٍ تحميل تاريخ الحجوزات… | |
| Aucune réservation sur ce centre. | لا توجد حجوزات في هذا المركز. | |
| Ouvrir dans Réservations | فتح في الحجوزات | |
| erreur de saisie du centre (hors score) | خطأ إدخال من المركز (خارج التقييم) | |
| Afficher plus | عرض المزيد | |
| Top clients — dépense totale | أفضل الزبائن — مجموع الإنفاق | |

### Personnel

| Français | Arabe (provisoire) | Correction |
|---|---|---|
| Jamais connecté | لم يتصل أبدًا | |
| Chargement impossible. | تعذّر التحميل. | |
| Compte existant rattaché à ce centre — son mot de passe est inchangé (rien à transmettre). | تم ربط حساب موجود بهذا المركز — كلمة مروره لم تتغير (لا شيء لتسليمه). | |
| Il est aussi rattaché à {centres}. | وهو مرتبط أيضًا بـ: {centres}. | |
| Création impossible. | تعذّر الإنشاء. | |
| {nom} retiré de l’équipe. | تمت إزالة {nom} من الفريق. | |
| Rôle de {nom} : {role}. | دور {nom}: {role}. | |
| Action impossible. | تعذّر تنفيذ الإجراء. | |
| {nom} déverrouillé — mot de passe inchangé. | تم إلغاء قفل حساب {nom} — كلمة المرور لم تتغير. | |
| Déverrouillage impossible. | تعذّر إلغاء القفل. | |
| Retirer ce membre ? | إزالة هذا العضو؟ | |
| Réinitialiser le mot de passe ? | إعادة تعيين كلمة المرور؟ | |
| Changer le rôle ? | تغيير الدور؟ | |
| {nom} n’aura plus accès au CRM de ce centre. Son compte reste utilisable pour tout autre centre auquel il serait rattaché. | لن يتمكن {nom} بعد الآن من الوصول إلى نظام التسيير لهذا المركز. يبقى حسابه صالحًا لأي مركز آخر يكون مرتبطًا به. | |
| Un nouveau mot de passe sera généré pour {nom}. Ses sessions ouvertes seront coupées. | سيتم توليد كلمة مرور جديدة لـ {nom}، وستُغلق جلساته المفتوحة. | |
| {nom} passe de {avant} à {apres}. | ينتقل {nom} من دور {avant} إلى دور {apres}. | |
| Qui a accès au CRM de ce centre, et avec quel rôle. | من يمكنه الوصول إلى نظام التسيير لهذا المركز، وبأي دور. | |
| Seul le propriétaire du centre peut ajouter, retirer ou changer un rôle. | المالك وحده يمكنه إضافة عضو أو إزالته أو تغيير دوره. | |
| + Ajouter un membre | + إضافة عضو | |
| Compte créé — identifiants à transmettre | تم إنشاء الحساب — بيانات الدخول للتسليم | |
| Mot de passe réinitialisé — identifiants à transmettre | تمت إعادة تعيين كلمة المرور — بيانات الدخول للتسليم | |
| Email de connexion | البريد الإلكتروني للدخول | |
| Rôle | الدور | |
| Un mot de passe est généré et affiché une seule fois. Si cet email a déjà un compte Moubarat, la création est refusée — sauf pour un ancien membre de ce centre, qui retrouve son accès avec son mot de passe inchangé. Pour une personne qui travaille déjà dans un autre centre, contactez Moubarat. | تُولَّد كلمة مرور وتظهر مرة واحدة فقط. إذا كان لهذا البريد حساب مبارات من قبل، يُرفض الإنشاء — إلا لعضو سابق في هذا المركز، فيستعيد وصوله بكلمة مروره دون تغيير. لشخص يعمل أصلًا في مركز آخر، اتصلوا بمبارات. | |
| Création… | جارٍ الإنشاء… | |
| Créer le compte | إنشاء الحساب | |
| Chargement de l’équipe… | جارٍ تحميل الفريق… | |
| Aucun membre pour l’instant. | لا يوجد أي عضو حاليًا. | |
| Dernière connexion | آخر اتصال | |
| Rôle de {nom} | دور {nom} | |
| Suspendu | موقوف | |
| Verrouillé | مقفل | |
| Réinitialiser le mot de passe | إعادة تعيين كلمة المرور | |
| Déverrouiller | إلغاء القفل | |
| Ce que chaque rôle peut faire | ما يمكن لكل دور فعله | |
| Confirmer | تأكيد | |

### Caisse

| Français | Arabe (provisoire) | Correction |
|---|---|---|
| La caisse se gère en Réception (ou plus) | يُسيَّر الصندوق من دور الاستقبال (أو أعلى) | |
| Le Staff pointe les présences, il ne touche pas à l'argent. | العامل يسجّل الحضور فقط، ولا يتعامل مع المال. | |
| Saisissez le fond de caisse en dinars (0 s’il n’y en a pas). | أدخلوا رصيد الافتتاح بالدينار (0 إن لم يوجد). | |
| Caisse ouverte. | تم فتح الصندوق. | |
| Un mouvement de caisse est toujours un montant entier strictement positif. | حركة الصندوق هي دائمًا مبلغ صحيح أكبر من صفر. | |
| Saisissez le montant compté dans la caisse avant de clôturer. | أدخلوا المبلغ المعدود في الصندوق قبل الإغلاق. | |
| Caisse clôturée. | تم إغلاق الصندوق. | |
| Chargement de la caisse… | جارٍ تحميل الصندوق… | |
| Ouvrir la caisse du jour | فتح صندوق اليوم | |
| Fonds d'ouverture (DA) | رصيد الافتتاح (دج) | |
| Ouvrir la caisse | فتح الصندوق | |
| Dernière clôture : {quand} · attendu {montant} par {nom} | آخر إغلاق: {quand} · المتوقع {montant} من طرف {nom} | |
| Encaisser ici (mouvement de caisse) et marquer une réservation « Payée » dans Réservations sont deux actions séparées, sans lien automatique entre elles. Pour que la caisse ET le suivi des réservations soient à jour, il faut faire les deux — l'une ne déclenche jamais l'autre. | التحصيل هنا (حركة صندوق) وتسجيل حجز «مدفوع» في الحجوزات عمليتان منفصلتان، دون أي ربط تلقائي بينهما. لكي يكون الصندوق ومتابعة الحجوزات محدَّثين معًا، يجب القيام بالاثنتين — إحداهما لا تُطلق الأخرى أبدًا. | |
| Caisse ouverte · par {nom} à {quand} | الصندوق مفتوح · فتحه {nom} · {quand} | |
| Fonds d'ouverture | رصيد الافتتاح | |
| Attendu en caisse | المتوقع في الصندوق | |
| Aucun mouvement pour l'instant. | لا توجد أي حركة حاليًا. | |
| Encaissement (DA) | تحصيل (دج) | |
| Référence | المرجع | |
| Enregistrer l'encaissement | تسجيل التحصيل | |
| Sortie (DA) | مصروف (دج) | |
| Motif | السبب | |
| Achat filets | شراء شباك المرمى | |
| Enregistrer la sortie | تسجيل المصروف | |
| Clôturer | إغلاق | |
| Montant compté (DA) | المبلغ المعدود (دج) | |
| Clôturer la caisse | إغلاق الصندوق | |
| Clôturer la caisse ? | إغلاق الصندوق؟ | |
| Attendu : | المتوقع: | |
| Compté : | المعدود: | |
| Écart : {montant} | الفارق: {montant} | |
| caisse juste. | الصندوق مضبوط. | |

### Journal

| Français | Arabe (provisoire) | Correction |
|---|---|---|
| Le journal d'audit se consulte en Manager | سجل العمليات يُطالَع من دور المدير | |
| Chaque action y est déjà enregistrée — demande à un manager du centre d'y accéder. | كل إجراء مسجَّل فيه مسبقًا — اطلبوا من مدير المركز الوصول إليه. | |
| À quoi sert le journal ? | ما فائدة السجل؟ | |
| C'est la boîte noire du centre — aucune action à faire ici, il | إنه الصندوق الأسود للمركز — لا شيء عليكم فعله هنا، فهو | |
| enregistre | يسجّل | |
| tout seul les gestes sensibles (création, déplacement, annulation, blocage, caisse, présence) et répond à « qui a bloqué le T2 mercredi ? ». Lecture seule, par nature. | تلقائيًا العمليات الحساسة (الإنشاء، النقل، الإلغاء، الحجب، الصندوق، الحضور) ويجيب عن سؤال «من حجب الملعب T2 يوم الأربعاء؟». للقراءة فقط، بطبيعته. | |
| Chaque action sensible, signée et horodatée | كل إجراء حساس، موقَّع ومؤرَّخ بالساعة | |
| Chargement du journal… | جارٍ تحميل السجل… | |
| Aucune action sensible pour l'instant. | لا يوجد أي إجراء حساس حاليًا. | |
| Hier | أمس | |
| Plateforme | المنصة | |
| Joueur | لاعب | |

### Centre

| Français | Arabe (provisoire) | Correction |
|---|---|---|
| Enregistré. | تم الحفظ. | |
| Donnez un nom au terrain (ex. T4). | أدخلوا اسم الملعب (مثال: T4). | |
| Ce nom de terrain existe déjà. | اسم الملعب هذا موجود مسبقًا. | |
| Le tarif horaire doit être un nombre entier positif. | يجب أن يكون السعر بالساعة عددًا صحيحًا موجبًا. | |
| Terrain {terrain} ajouté. | تمت إضافة الملعب {terrain}. | |
| L’adresse ne peut pas être vide. | لا يمكن ترك العنوان فارغًا. | |
| Choisissez le format à ajouter. | اختاروا الصيغة المراد إضافتها. | |
| Format ajouté — {n} bandes copiées, à régler ci-dessous. | تمت إضافة الصيغة — عدد الفترات السعرية المنسوخة: {n}، اضبطوها أدناه. | |
| Format ajouté — {n} bande copiée, à régler ci-dessous. | تمت إضافة الصيغة — عدد الفترات السعرية المنسوخة: {n}، اضبطوها أدناه. | |
| Format ajouté (tarif plat, sans bande). | تمت إضافة الصيغة (سعر موحّد، دون فترات سعرية). | |
| DA / h | دج / الساعة | |
| Un montant entier en DA, supérieur à 0. | مبلغ صحيح بالدينار، أكبر من 0. | |
| Format retiré. | تمت إزالة الصيغة. | |
| Module Caisse activé — il apparaît dans la navigation. | تم تفعيل وحدة الصندوق — تظهر الآن في القائمة. | |
| Module Caisse désactivé. | تم تعطيل وحدة الصندوق. | |
| La fermeture doit suivre l'ouverture. | يجب أن يكون وقت الإغلاق بعد وقت الفتح. | |
| Enregistré — jour fermé. | تم الحفظ — اليوم مغلق. | |
| Choisissez une date. | اختاروا تاريخًا. | |
| La fin doit suivre le début. | يجب أن تكون النهاية بعد البداية. | |
| Fermeture enregistrée. | تم حفظ الإغلاق. | |
| Fermeture retirée. | تمت إزالة الإغلاق. | |
| Tout ce qui est réglé ici alimente la | كل ما يُضبط هنا يغذّي | |
| fiche technique du centre côté app joueur | البطاقة التقنية للمركز في تطبيق اللاعبين | |
| — celle qu'on voit avant de réserver {centre} : terrains, équipements en icônes, description, photos, horaires. | — وهي ما يراه اللاعب قبل حجز {centre}: الملاعب، التجهيزات في شكل أيقونات، الوصف، الصور، أوقات العمل. | |
| Le paramétrage du centre se fait en Manager | ضبط إعدادات المركز من صلاحيات المدير | |
| Vous pouvez consulter, pas modifier. | يمكنكم الاطلاع دون التعديل. | |
| Fiche du centre indisponible | بطاقة المركز غير متاحة | |
| Chargement de la fiche du centre… | جارٍ تحميل بطاقة المركز… | |
| Identité | الهوية | |
| Adresse | العنوان | |
| Voir sur la carte ↗ | عرض على الخريطة ↗ | |
| Téléphone (affiché aux joueurs) | الهاتف (يظهر للاعبين) | |
| Description (fiche app) | الوصف (بطاقة التطبيق) | |
| Terrains — ajouter, régler, archiver (l'historique est toujours conservé) | الملاعب — إضافة، ضبط، أرشفة (تبقى البيانات السابقة محفوظة دائمًا) | |
| Sport | الرياضة | |
| Format | الصيغة | |
| Env. | داخلي/خارجي | |
| Surface | الأرضية | |
| Statut | الحالة | |
| Aucun terrain — ajoutez le premier ci-dessous. | لا يوجد ملعب — أضيفوا الأول أدناه. | |
| Formats et tarifs : carte Tarifs ci-dessous | الصيغ والأسعار: بطاقة الأسعار أدناه | |
| Couverture de {terrain} | تغطية {terrain} | |
| Extérieur | خارجي | |
| Intérieur | داخلي | |
| Ajouter un terrain | إضافة ملعب | |
| Équipements — cochés ici, traduits en icônes dans la fiche app | التجهيزات — تُحدَّد هنا، وتظهر كأيقونات في بطاقة التطبيق | |
| Photos du centre | صور المركز | |
| Photo d'ambiance | صورة الأجواء | |
| Terrains | الملاعب | |
| Vestiaires | غرف تبديل الملابس | |
| Vue extérieure | منظر خارجي | |
| L'ajout de photos arrive bientôt. En attendant, l'app affiche le logo Moubarat sur la fiche du centre. | إضافة الصور متاحة قريبًا. في الأثناء، يعرض التطبيق شعار مبارات على بطاقة المركز. | |
| Tarifs — appliqués partout : création, modification, abonnements | الأسعار — تُطبَّق في كل مكان: الإنشاء، التعديل، الاشتراكات | |
| Aucun terrain, donc aucun tarif. | لا يوجد ملعب، وبالتالي لا يوجد سعر. | |
| Même tarif que {formats} — jamais différencié, à régler si ce format doit coûter autre chose | نفس سعر {formats} — لم يُميَّز بعد، اضبطوه إن كان لهذه الصيغة سعر مختلف | |
| Un terrain propose toujours au moins un format | يقترح كل ملعب صيغة واحدة على الأقل | |
| Retirer | إزالة | |
| Prix de base | السعر الأساسي | |
| Toutes heures sans règle | كل الساعات دون قاعدة خاصة | |
| Prix de base {format} {terrain} | السعر الأساسي {format} {terrain} | |
| Prix de base {format} — {terrain} | السعر الأساسي {format} — {terrain} | |
| Ajouter un format | إضافة صيغة | |
| Format à ajouter à {terrain} | الصيغة المراد إضافتها إلى {terrain} | |
| Format… | الصيغة… | |
| Tarif | السعر | |
| Tarif du format à ajouter à {terrain} | سعر الصيغة المراد إضافتها إلى {terrain} | |
| Bandes tarifaires du format à ajouter à {terrain} | الفترات السعرية للصيغة المراد إضافتها إلى {terrain} | |
| Bandes : copier de {format} | الفترات السعرية: نسخ من {format} | |
| Bandes : aucune (tarif plat) | الفترات السعرية: بدون (سعر موحّد) | |
| Ajouter | إضافة | |
| Modules optionnels | الوحدات الاختيارية | |
| Module Caisse — contrôle des encaissements (sessions, écart de clôture). Désactivé : « Payé » fonctionne normalement, sans traçage. | وحدة الصندوق — مراقبة التحصيل (الجلسات، فارق الإغلاق). عند تعطيلها: يعمل «مدفوع» بشكل عادي، دون تتبّع. | |
| Horaires d'ouverture — le planning et le remplissage s'y règlent aussitôt | أوقات العمل — يتكيّف معها جدول الحجوزات ونسبة الإشغال فورًا | |
| Horaires non renseignés | أوقات العمل غير مُدخلة | |
| Fermé | مغلق | |
| + autre plage non éditée ici | + فترة أخرى لا تُعدَّل هنا | |
| Fermer | إغلاق | |
| Rouvrir | إعادة الفتح | |
| Fermetures exceptionnelles — jour férié, congé, maintenance | الإغلاقات الاستثنائية — عطلة رسمية، إجازة، صيانة | |
| Fermetures indisponibles | الإغلاقات غير متاحة | |
| Chargement des fermetures… | جارٍ تحميل الإغلاقات… | |
| Aucune fermeture exceptionnelle programmée. | لا يوجد إغلاق استثنائي مبرمج. | |
| Terrain {terrain} | الملعب {terrain} | |
| Tout le centre | المركز بأكمله | |
| Fermer le centre ou un terrain | إغلاق المركز أو ملعب | |
| Changer ce tarif ? | تغيير هذا السعر؟ | |
| Le nouveau tarif s’applique aux réservations créées à partir de maintenant. Les réservations déjà prises gardent leur prix. | يُطبَّق السعر الجديد على الحجوزات المُنشأة ابتداءً من الآن. تحتفظ الحجوزات السابقة بسعرها. | |
| Enregistrer le tarif | حفظ السعر | |
| Retirer ce format ? | إزالة هذه الصيغة؟ | |
| Le format {format} n'est plus proposé sur {terrain}, et ses bandes tarifaires (heures pleines…) sont supprimées avec lui. | لن تُقترح الصيغة {format} بعد الآن على {terrain}، وتُحذف معها فتراتها السعرية (ساعات الذروة…). | |
| Les réservations déjà prises dans ce format sont conservées telles quelles. | تبقى الحجوزات السابقة بهذه الصيغة كما هي. | |
| Archiver ce terrain ? | أرشفة هذا الملعب؟ | |
| {terrain} disparaît des réservations, du planning et de la fiche app. | يختفي {terrain} من الحجوزات وجدول الحجوزات وبطاقة التطبيق. | |
| L'historique est conservé — désarchivable à tout moment depuis le statut. | تبقى البيانات السابقة محفوظة — يمكن إلغاء الأرشفة في أي وقت من خانة الحالة. | |
| À déplacer ou annuler avant d’archiver | يجب نقلها أو إلغاؤها قبل الأرشفة | |
| Réservation | الحجز | |
| Abonnement | اشتراك | |
| … et {n} autres. | … وغيرها (العدد: {n}). | |
| … et 1 autre. | … وعنصر آخر. | |
| Archivage… | جارٍ الأرشفة… | |
| Archiver | أرشفة | |
| Nom | الاسم | |
| Tarif horaire (DA / h) | السعر بالساعة (دج / الساعة) | |
| Retour | رجوع | |
| Retirer cette fermeture ? | إزالة هذا الإغلاق؟ | |
| Le terrain {terrain} redevient réservable le {date}, aux horaires normalement ouverts. | يصبح الملعب {terrain} متاحًا للحجز من جديد يوم {date}، في أوقات العمل العادية. | |
| Le centre redevient réservable le {date}, aux horaires normalement ouverts. | يصبح المركز متاحًا للحجز من جديد يوم {date}، في أوقات العمل العادية. | |
| Retrait… | جارٍ الإزالة… | |
| Fermeture exceptionnelle | إغلاق استثنائي | |
| Date | التاريخ | |
| Toute la journée (horaires réels de ce jour, queue après minuit comprise) | اليوم كاملًا (أوقات العمل الفعلية لهذا اليوم، بما فيها ما بعد منتصف الليل) | |
| Début | البداية | |
| Label (optionnel) | التسمية (اختياري) | |
| Ex. Aïd el-Kebir | مثال: عيد الأضحى | |
| À déplacer ou annuler avant de fermer | يجب نقلها أو إلغاؤها قبل الإغلاق | |
| Tous les jours | كل الأيام | |
| Vendredi | الجمعة | |

### Équipes

| Français | Arabe (provisoire) | Correction |
|---|---|---|
| Équipes ayant joué sur ce centre (défis) | الفرق التي لعبت في هذا المركز (التحديات) | |
| Chargement des équipes… | جارٍ تحميل الفرق… | |
| Aucune équipe n'a encore joué de match issu d'un défi sur ce centre. | لم يلعب أي فريق بعد مباراة ناتجة عن تحدٍّ في هذا المركز. | |
| Matchs joués sur ce centre | المباريات الملعوبة في هذا المركز | |
| Membres actifs | الأعضاء النشطون | |

### Libellés partagés (menu, statuts, jours, sports, rôles…)

| Français | Arabe (provisoire) | Correction |
|---|---|---|
| … | … | |
| À surveiller | للمراقبة | |
| Abonnements | الاشتراكات | |
| Afficher le CRM en arabe | عرض الواجهة بالعربية | |
| Afficher le CRM en français | عرض الواجهة بالفرنسية | |
| Annulé | ملغى | |
| App Moubarat | تطبيق مبارات | |
| Archivé | مؤرشف | |
| Au moins un terrain actif | ملعب واحد نشط على الأقل | |
| Au quotidien | يوميًا | |
| aucun compte gérant — personne ne pourra confirmer les réservations | لا يوجد حساب مسيّر — لن يتمكن أحد من تأكيد الحجوزات | |
| aucun horaire d’ouverture | لا توجد أوقات عمل | |
| aucun terrain actif | لا يوجد ملعب نشط | |
| Autre | أخرى | |
| Basket | كرة السلة | |
| Café / snack | مقهى / وجبات خفيفة | |
| Caisse | الصندوق | |
| Casiers | خزائن | |
| Ce compte n’est rattaché à aucun centre. | هذا الحساب غير مرتبط بأي مركز. | |
| Centre | المركز | |
| Centre → adresse, téléphone, description et équipements : c’est ce que voient les joueurs dans l’app. | المركز ← العنوان والهاتف والوصف والتجهيزات: هذا ما يراه اللاعبون في التطبيق. | |
| Centre → Horaires d’ouverture, jour par jour. Les jours fériés ou travaux : Fermetures exceptionnelles. | المركز ← أوقات العمل، يومًا بيوم. أيام العطل أو الأشغال: الإغلاقات الاستثنائية. | |
| Centre → Terrains : un terrain par surface, avec ses formats (5v5, padel…). Puis Tarifs : un prix de base par format, et les heures pleines si besoin. | المركز ← الملاعب: ملعب لكل أرضية، مع صيغه (5v5، بادل…). ثم الأسعار: سعر أساسي لكل صيغة، وساعات الذروة عند الحاجة. | |
| Chaque terrain actif a un tarif | لكل ملعب نشط سعر | |
| Chasubles | صدريات | |
| Choisissez au moins un sport. | اختاروا رياضة واحدة على الأقل. | |
| Clients | الزبائن | |
| Confiance élevée | ثقة عالية | |
| Confiance faible | ثقة ضعيفة | |
| Confiance moyenne | ثقة متوسطة | |
| Confirmée par le joueur | أكّدها اللاعب | |
| Connexion au serveur Moubarat impossible. Vérifiez votre connexion internet, puis réessayez. | تعذّر الاتصال بخادم مبارات. تحقّقوا من اتصالكم بالإنترنت ثم أعيدوا المحاولة. | |
| Connexion impossible. Réessayez. | تعذّر تسجيل الدخول. أعيدوا المحاولة. | |
| Consultation du planning uniquement : aucune réservation, aucun encaissement. | الاطلاع على جدول الحجوزات فقط: لا حجوزات ولا تحصيل. | |
| CPT | شباك | |
| Dans 4 semaines | بعد 4 أسابيع | |
| Dans 8 semaines | بعد 8 أسابيع | |
| Dashboard | لوحة القيادة | |
| Déjà annulé, non modifiable | ملغى، لا يمكن التعديل | |
| Déjà honoré, non modifiable | تم تسجيل الحضور، لا يمكن التعديل | |
| Déjà no-show, non modifiable | مسجَّل غائبًا، لا يمكن التعديل | |
| Déjà payé, non modifiable | مدفوع، لا يمكن التعديل | |
| Des horaires d’ouverture | أوقات العمل | |
| Dim. | الأحد | |
| Double | زوجي | |
| Douches | دوش | |
| Éclairage nocturne | إنارة ليلية | |
| Envoi impossible. Réessayez. | تعذّر الإرسال. أعيدوا المحاولة. | |
| Envoi impossible. Vérifiez votre connexion et réessayez. | تعذّر الإرسال. تحقّقوا من اتصالكم وأعيدوا المحاولة. | |
| Événement | حدث | |
| Fiable | موثوق | |
| Fiche du centre | بطاقة المركز | |
| Football | كرة القدم | |
| Gazon naturel | عشب طبيعي | |
| Honoré | حاضر | |
| Horaires | أوقات العمل | |
| Impossible de charger les documents. Vérifiez votre connexion et réessayez. | تعذّر تحميل الوثائق. تحقّقوا من اتصالكم وأعيدوا المحاولة. | |
| Jeu. | الخميس | |
| Jour férié | عطلة رسمية | |
| Journal | السجل | |
| Le comptoir : créer, modifier et annuler des réservations (avec motif), confirmer les réservations par téléphone, encaisser, caisse (si activée), fiche des clients. | الشباك: إنشاء الحجوزات وتعديلها وإلغاؤها (مع ذكر السبب)، تأكيد الحجوزات الهاتفية، التحصيل، الصندوق (إن كان مفعّلًا)، بطاقات الزبائن. | |
| Le consentement à être recontacté est requis. | الموافقة على إعادة الاتصال مطلوبة. | |
| Le joueur dit que ce n’est pas lui | يقول اللاعب إنه ليس هو | |
| Location de matériel | كراء العتاد | |
| Lun. | الإثنين | |
| Maintenance | صيانة | |
| Manager | المدير | |
| Mar. | الثلاثاء | |
| MB | مبارات | |
| Mer. | الأربعاء | |
| Moubarat | مبارات | |
| Moubarat est prévenu : votre centre est prêt à être publié. | تم إعلام مبارات: مركزكم جاهز للنشر. | |
| Padel | البادل | |
| Parking | موقف سيارات | |
| Parquet | باركيه | |
| Payé | مدفوع | |
| Pelouse hybride | عشب هجين | |
| Personnel | الموظفون | |
| Personnel : ajoutez la réception (un compte par personne). Le mot de passe s’affiche une seule fois, à transmettre. | الموظفون: أضيفوا موظفي الاستقبال (حساب لكل شخص). تظهر كلمة المرور مرة واحدة فقط، يجب تسليمها. | |
| Planning | جدول الحجوزات | |
| Planning : cliquez sur une case libre pour réserver. Réservations : marquez « Payée », « Honorée » ou « No-show ». Caisse (si activée) : ouverture et clôture. | جدول الحجوزات: انقروا على خانة فارغة للحجز. الحجوزات: سجّلوا «مدفوع» أو «حاضر» أو «غائب». الصندوق (إن كان مفعّلًا): الفتح والإقفال. | |
| Prévenu — en attente de sa réponse | تم إعلامه — في انتظار رده | |
| Propriétaire | المالك | |
| Publication | النشر | |
| Quand la liste ci-dessus est complète : « Signaler que c’est prêt » dans le bandeau. Moubarat valide, et le centre apparaît dans l’app joueur. | عند اكتمال القائمة أعلاه: «الإشعار بالجاهزية» في الشريط. تصادق مبارات، فيظهر المركز في تطبيق اللاعبين. | |
| Réception | الاستقبال | |
| Réservation annulée. | تم إلغاء الحجز. | |
| Réservation marquée honorée. | تم تسجيل الحضور لهذا الحجز. | |
| Réservation marquée no-show. | تم تسجيل الغياب لهذا الحجز. | |
| Réservation marquée payée. | تم تسجيل دفع هذا الحجز. | |
| Résine | راتنج | |
| Risqué | عالي المخاطر | |
| Sam. | السبت | |
| Sans date de fin | بدون تاريخ نهاية | |
| Simple | فردي | |
| Staff | عامل | |
| Synthétique | عشب اصطناعي | |
| TÉL | هاتف | |
| TÉL ? | هاتف ؟ | |
| Tél. | الهاتف | |
| téléphone du centre non renseigné | هاتف المركز غير مُدخل | |
| Terrains et tarifs | الملاعب والأسعار | |
| Tout sauf le personnel : terrains, tarifs, horaires et fermetures, fiche du centre, analytics, abonnements, journal, corrections de statut — et tout ce que fait la réception. | كل شيء ما عدا الموظفين: الملاعب، الأسعار، أوقات العمل والإغلاقات، بطاقة المركز، التحليلات، الاشتراكات، السجل، تصحيح الحالات — وكل ما يقوم به الاستقبال. | |
| Tout, y compris le personnel : ajouter, retirer, changer les rôles. | كل شيء، بما في ذلك الموظفون: الإضافة والإزالة وتغيير الأدوار. | |
| Très fiable | موثوق جدًا | |
| Tribunes | مدرجات | |
| Un compte gérant actif | حساب مسيّر نشط | |
| Un téléphone | رقم هاتف | |
| Une erreur est survenue. Réessayez. | حدث خطأ. أعيدوا المحاولة. | |
| Ven. | الجمعة | |
| Votre équipe | فريقكم | |
| WhatsApp | واتساب | |
| WiFi | واي فاي | |

## 3. Messages d’erreur du serveur

Le serveur répond en français ; le CRM traduit à la réception. `{1}`, `{2}`… : valeur insérée (un nom de centre, un rôle,
un nombre). Les messages purement techniques gardent le nom du paramètre (`fieldId`, `limit`…) : un réceptionniste ne les
voit qu’en cas de bug.

| Français | Arabe (provisoire) | Correction |
|---|---|---|
| Erreur interne. Réessayez. | خطأ داخلي. أعيدوا المحاولة. | |
| Identifiant invalide. | معرّف غير صالح. | |
| Réservé à l’administrateur plateforme. | مخصّص لمسؤول المنصة. | |
| Vous ne faites pas partie de l’équipe de ce centre. | لستم من فريق هذا المركز. | |
| Session expirée ou révoquée. Reconnectez-vous. | انتهت الجلسة أو أُلغيت. أعيدوا تسجيل الدخول. | |
| Curseur invalide. | مؤشر الصفحة غير صالح. | |
| limit invalide : un entier de 1 à {1}. | قيمة limit غير صالحة: عدد صحيح من 1 إلى {1}. | |
| Trop d’essais. {1} dans {2}. | محاولات كثيرة جدًا. {1} بعد {2}. | |
| Le téléphone doit être une chaîne de caractères. | يجب أن يكون الهاتف نصًّا. | |
| Téléphone : 40 caractères maximum, texte simple. | الهاتف: 40 حرفًا كحد أقصى، نص بسيط. | |
| Email ou mot de passe incorrect. | البريد الإلكتروني أو كلمة المرور غير صحيحة. | |
| Ce compte est suspendu. | هذا الحساب موقوف. | |
| Nouveau mot de passe trop court : {1} caractères minimum. | كلمة المرور الجديدة قصيرة جدًا (عدد الرموز: {1} على الأقل). | |
| Le nouveau mot de passe doit être différent de l’actuel. | يجب أن تختلف كلمة المرور الجديدة عن الحالية. | |
| Mot de passe actuel incorrect. | كلمة المرور الحالية غير صحيحة. | |
| Email et mot de passe requis. | البريد الإلكتروني وكلمة المرور مطلوبان. | |
| Mot de passe actuel et nouveau mot de passe requis. | كلمة المرور الحالية وكلمة المرور الجديدة مطلوبتان. | |
| Centre introuvable. | المركز غير موجود. | |
| Adresse email invalide. | عنوان البريد الإلكتروني غير صالح. | |
| Rôle invalide : {1}. | دور غير صالح: {1}. | |
| {1} : caractères non autorisés. | {1}: رموز غير مسموح بها. | |
| {1} : entre {2} et {3} caractères. | {1}: عدد الأحرف بين {2} و{3}. | |
| Numéro de téléphone invalide. | رقم الهاتف غير صالح. | |
| Choisissez au moins un sport : football, padel ou basket. | اختاروا رياضة واحدة على الأقل: كرة القدم أو البادل أو كرة السلة. | |
| Nombre de terrains : un entier entre 1 et 100. | عدد الملاعب: عدد صحيح بين 1 و100. | |
| Message : 500 caractères maximum, texte simple. | الرسالة: 500 حرف كحد أقصى، نص بسيط. | |
| Le consentement à être recontacté est requis. | الموافقة على معاودة الاتصال بكم مطلوبة. | |
| Match introuvable. | المباراة غير موجودة. | |
| Paramètres from/to attendus au format YYYY-MM-DD. | يُنتظر المعاملان from/to بصيغة YYYY-MM-DD. | |
| to doit être postérieur ou égal à from. | يجب أن يكون to مساويًا لـ from أو بعده. | |
| La période ne peut pas dépasser 366 jours. | لا يمكن أن تتجاوز الفترة 366 يومًا. | |
| Un export couvre 3 mois au plus. Pour une période plus longue, faites plusieurs exports. | يغطي التصدير 3 أشهر على الأكثر. لفترة أطول، قوموا بعدة عمليات تصدير. | |
| Ce centre est actuellement indisponible. | هذا المركز غير متاح حاليًا. | |
| Durée invalide : entre 30 et 360 minutes. | مدة غير صالحة: بين 30 و360 دقيقة. | |
| Pas invalide : entre 5 et 60 minutes. | خطوة غير صالحة: بين 5 و60 دقيقة. | |
| Paramètre date attendu au format YYYY-MM-DD. | يُنتظر المعامل date بصيغة YYYY-MM-DD. | |
| Sport invalide : FOOTBALL, PADEL ou BASKET. | رياضة غير صالحة: FOOTBALL أو PADEL أو BASKET. | |
| Paramètre from attendu au format YYYY-MM-DD. | يُنتظر المعامل from بصيغة YYYY-MM-DD. | |
| Cette réservation a un match rattaché — le terrain et l’horaire ne se modifient plus une fois le match créé, même sans inscrit. Annule la réservation pour libérer le créneau (le match s’annule avec elle). | هذا الحجز مرتبط بمباراة — لا يمكن تعديل الملعب ولا التوقيت بعد إنشاء المباراة، حتى من دون مسجَّلين. ألغوا الحجز لتحرير التوقيت (تُلغى المباراة معه). | |
| Le centre est fermé sur ce créneau (fermeture exceptionnelle). | المركز مغلق في هذا التوقيت (إغلاق استثنائي). | |
| Un blocage se débloque et se recrée — il ne se déplace pas. | الحجب يُرفع ثم يُعاد إنشاؤه — لا يُنقل. | |
| Terrain introuvable. | الملعب غير موجود. | |
| fieldId manquant. | fieldId مفقود. | |
| startMin invalide (minutes depuis minuit, 0–2879). | قيمة startMin غير صالحة (دقائق منذ منتصف الليل، 0–2879). | |
| Tu as déjà {1} réservation{2} téléphonique{3} en attente de confirmation par le centre — attends qu’il les confirme, ou annule-en une, avant d’en déclarer une autre. | عدد حجوزاتكم الهاتفية التي تنتظر تأكيد المركز: {1} — انتظروا أن يؤكدها، أو ألغوا واحدًا منها، قبل التصريح بحجز آخر. | |
| Tu as déjà un match ou une réservation sur ce créneau. | لديكم بالفعل مباراة أو حجز في هذا التوقيت. | |
| Cette réservation n’est pas la vôtre. | هذا الحجز ليس لكم. | |
| La réservation a changé de centre entre-temps. | تغيّر مركز الحجز في الأثناء. | |
| Source invalide : MOUBARAT, PHONE ou WALK_IN. | مصدر غير صالح: MOUBARAT أو PHONE أو WALK_IN. | |
| reservationName requis pour une réservation {1}. | reservationName مطلوب لحجز {1}. | |
| Les réservations sont ouvertes jusqu’à {1} jours à l’avance. | الحجز مفتوح مسبقًا لمدة أقصاها {1} يومًا. | |
| Seule une réservation téléphonique se confirme. | لا يُؤكَّد إلا الحجز الهاتفي. | |
| Déjà confirmée. | تم تأكيده مسبقًا. | |
| Cette réservation est « {1} » — plus rien à confirmer. | حالة هذا الحجز «{1}» — لم يعد هناك ما يُؤكَّد. | |
| Statut cible invalide : HONORED, PAID, NO_SHOW ou CANCELLED. | الحالة المطلوبة غير صالحة: HONORED أو PAID أو NO_SHOW أو CANCELLED. | |
| recordCash doit être un booléen. | يجب أن يكون recordCash قيمة منطقية (صح/خطأ). | |
| Motif d’annulation requis : STAFF_ERROR ou CLIENT. | سبب الإلغاء مطلوب: STAFF_ERROR أو CLIENT. | |
| Cette réservation n’est pas marquée no-show. | هذا الحجز غير مسجَّل غائبًا. | |
| Seule une réservation « Honorée » ou « Payée » se corrige ici. | لا يُصحَّح هنا إلا حجز «حاضر» أو «مدفوع». | |
| Recherche trop courte (2 caractères au moins). | البحث قصير جدًا (حرفان على الأقل). | |
| Recherche trop longue (80 caractères au plus). | البحث طويل جدًا (80 حرفًا على الأكثر). | |
| Ce code promo a atteint son plafond d’utilisations. | بلغ هذا الرمز الترويجي الحد الأقصى لعدد الاستعمالات. | |
| Ce créneau vient d’être pris sur ce terrain. Choisissez un autre horaire. | تم حجز هذا التوقيت للتو في هذا الملعب. اختاروا توقيتًا آخر. | |
| Impossible d’attribuer une référence. Réessayez. | تعذّر منح مرجع للحجز. أعيدوا المحاولة. | |
| Ce terrain ne propose aucun format tarifé. | لا يقترح هذا الملعب أي صيغة محدَّدة السعر. | |
| Ce terrain ne propose pas le format {1}. | لا يقترح هذا الملعب الصيغة {1}. | |
| Ce terrain propose plusieurs formats : précisez lequel. | يقترح هذا الملعب عدة صيغ: حدّدوا أيّها. | |
| Code promo invalide ou inactif. | رمز ترويجي غير صالح أو غير نشط. | |
| Ce code promo ne s’applique pas à ce créneau. | لا ينطبق هذا الرمز الترويجي على هذا التوقيت. | |
| Réservation introuvable. | الحجز غير موجود. | |
| Une caisse est déjà ouverte — clôture-la d’abord. | يوجد صندوق مفتوح بالفعل — أغلقوه أولًا. | |
| Le fonds d’ouverture est un entier positif. | رصيد الافتتاح عدد صحيح موجب. | |
| kind invalide : COLLECTION ou PAYOUT. | قيمة kind غير صالحة: COLLECTION أو PAYOUT. | |
| amountDa doit être un entier strictement positif. | يجب أن يكون amountDa عددًا صحيحًا أكبر من صفر. | |
| Aucune caisse ouverte pour ce centre. | لا يوجد صندوق مفتوح لهذا المركز. | |
| declaredClosingDa est un entier positif. | declaredClosingDa عدد صحيح موجب. | |
| Session de caisse introuvable pour ce centre. | جلسة الصندوق غير موجودة لهذا المركز. | |
| Tri invalide : bookings ou spent. | ترتيب غير صالح: bookings أو spent. | |
| Aucune réservation de ce client sur ce centre. | لا يوجد أي حجز لهذا الزبون في هذا المركز. | |
| Client introuvable sur ce centre. | الزبون غير موجود في هذا المركز. | |
| Motif invalide : {1}. | سبب غير صالح: {1}. | |
| Terrain introuvable pour ce centre. | الملعب غير موجود في هذا المركز. | |
| Ce jour n’a pas d’horaires définis — rien à fermer. | لا توجد أوقات عمل محدَّدة لهذا اليوم — لا شيء للإغلاق. | |
| startMin doit être entre 0 et 1439. | يجب أن يكون startMin بين 0 و1439. | |
| La fin de la fermeture doit suivre son début. | يجب أن تكون نهاية الإغلاق بعد بدايته. | |
| Fermeture introuvable pour ce centre. | الإغلاق غير موجود لهذا المركز. | |
| Document inconnu. | وثيقة غير معروفة. | |
| label manquant. | label مفقود. | |
| validFrom/validUntil attendus au format date ISO. | يُنتظر validFrom/validUntil بصيغة تاريخ ISO. | |
| fieldIds doit être une liste d’identifiants de terrains. | يجب أن يكون fieldIds قائمة معرّفات ملاعب. | |
| Un ou plusieurs terrains ne sont pas de ce centre. | ملعب واحد أو أكثر لا ينتمي إلى هذا المركز. | |
| Code promo introuvable pour ce centre. | الرمز الترويجي غير موجود لهذا المركز. | |
| holderName manquant. | holderName مفقود. | |
| activeFrom attendu au format YYYY-MM-DD. | يُنتظر activeFrom بصيغة YYYY-MM-DD. | |
| activeUntil attendu au format YYYY-MM-DD. | يُنتظر activeUntil بصيغة YYYY-MM-DD. | |
| pricePerSessionDa attendu (entier de DA > 0). | يُنتظر pricePerSessionDa (عدد صحيح بالدينار > 0). | |
| Statut cible invalide : HONORED, PAID ou NO_SHOW. | الحالة المطلوبة غير صالحة: HONORED أو PAID أو NO_SHOW. | |
| Ce créneau chevauche l'abonnement déjà actif de {1}. | يتداخل هذا التوقيت مع الاشتراك النشط لـ {1}. | |
| Ce motif chevauche une réservation déjà existante sur une occurrence future — impossible de créer l’abonnement. | يتداخل هذا التوقيت الأسبوعي مع حجز موجود في أحد المواعيد القادمة — يتعذّر إنشاء الاشتراك. | |
| Cet abonnement est déjà résilié. | تم فسخ هذا الاشتراك مسبقًا. | |
| weekday invalide (0–6). | قيمة weekday غير صالحة (0–6). | |
| startMin invalide. | قيمة startMin غير صالحة. | |
| Prix par séance : un entier de DA supérieur à 0. | سعر الحصة: عدد صحيح بالدينار أكبر من 0. | |
| La date de fin doit être postérieure à la date de début. | يجب أن يكون تاريخ النهاية بعد تاريخ البداية. | |
| Abonnement introuvable pour ce centre. | الاشتراك غير موجود لهذا المركز. | |
| Fixez d’abord le prix par séance de cet abonnement (écran Abonnements). | حدِّدوا أولًا سعر الحصة لهذا الاشتراك (شاشة الاشتراكات). | |
| Date de séance attendue au format AAAA-MM-JJ. | يُنتظر تاريخ الحصة بصيغة سنة-شهر-يوم (YYYY-MM-DD). | |
| Date de séance invalide. | تاريخ الحصة غير صالح. | |
| Cet abonnement n’a pas de séance ce jour-là. | لا توجد حصة لهذا الاشتراك في ذلك اليوم. | |
| Cette séance n’a pas de statut à corriger. | لا توجد حالة لتصحيحها في هذه الحصة. | |
| Ce compte est déjà rattaché à {1} ({2}). | هذا الحساب مرتبط بالفعل بـ {1} ({2}). | |
| Cette adresse est celle d’un compte administrateur plateforme — elle ne peut pas être rattachée à un centre. | هذا العنوان خاص بحساب مسؤول المنصة — لا يمكن ربطه بمركز. | |
| Cette adresse vient d’être utilisée — relancez la création. | استُعمل هذا العنوان للتو — أعيدوا محاولة الإنشاء. | |
| Le mot de passe d’un administrateur plateforme ne se réinitialise pas depuis cet écran. | لا تُعاد تهيئة كلمة مرور مسؤول المنصة من هذه الشاشة. | |
| Ce compte est aussi rattaché à un autre centre : seul le support Moubarat peut réinitialiser son mot de passe. | هذا الحساب مرتبط أيضًا بمركز آخر: وحده دعم مبارات يمكنه إعادة تهيئة كلمة مروره. | |
| Un administrateur plateforme ne se déverrouille pas depuis cet écran. | لا يُرفع قفل حساب مسؤول المنصة من هذه الشاشة. | |
| Le rôle d’un administrateur plateforme ne se gère pas depuis cet écran. | لا يُسيَّر دور مسؤول المنصة من هذه الشاشة. | |
| Impossible : ce serait le dernier propriétaire actif de ce centre. | غير ممكن: سيبقى هذا المركز دون أي مالك نشط. | |
| Un administrateur plateforme ne se retire pas d’un centre depuis cet écran. | لا يُسحب مسؤول المنصة من مركز عبر هذه الشاشة. | |
| Le nom doit faire entre 2 et 60 caractères. | يجب أن يتراوح طول الاسم بين 2 و60 حرفًا. | |
| Compte introuvable pour ce centre. | الحساب غير موجود في هذا المركز. | |
| Rien à signaler : {1}. | لا داعي للإشعار: {1}. | |
| Moubarat a déjà été prévenu il y a moins de 24 h — la validation est en cours. | تم إشعار مبارات بالفعل منذ أقل من 24 ساعة — المصادقة جارية. | |
| L’adresse ne peut pas être vide. | لا يمكن ترك العنوان فارغًا. | |
| equipments doit être un tableau de chaînes. | يجب أن يكون equipments قائمة نصوص. | |
| cashModuleEnabled doit être un booléen. | يجب أن يكون cashModuleEnabled قيمة منطقية (صح/خطأ). | |
| Aucun champ à modifier. | لا يوجد أي حقل للتعديل. | |
| Le nom du terrain ne peut pas être vide. | لا يمكن ترك اسم الملعب فارغًا. | |
| sport invalide : {1}. | رياضة غير صالحة: {1}. | |
| status invalide : {1}. | قيمة status غير صالحة: {1}. | |
| Le nom du terrain est requis (ex. T4). | اسم الملعب مطلوب (مثلًا T4). | |
| formats invalide : au moins un parmi {1}. | قيمة formats غير صالحة: واحدة على الأقل من {1}. | |
| hourlyRateDa est un entier strictement positif. | hourlyRateDa عدد صحيح أكبر من صفر. | |
| Ce nom de terrain existe déjà. | اسم الملعب هذا موجود مسبقًا. | |
| format invalide : {1}. | صيغة غير صالحة: {1}. | |
| Ce format est déjà configuré sur ce terrain — modifiez son prix plutôt. | هذه الصيغة مضبوطة بالفعل في هذا الملعب — عدّلوا سعرها بدلًا من ذلك. | |
| Les bandes à copier viennent d’un format déjà configuré sur ce terrain. | يجب أن تُنسخ الفترات السعرية من صيغة مضبوطة بالفعل في هذا الملعب. | |
| Ce format n’est pas configuré sur ce terrain. | هذه الصيغة غير مضبوطة في هذا الملعب. | |
| Un terrain propose toujours au moins un format — configurez-en un autre avant de retirer celui-ci. | يقترح كل ملعب صيغة واحدة على الأقل — اضبطوا صيغة أخرى قبل إزالة هذه. | |
| rateDa est un entier strictement positif. | rateDa عدد صحيح أكبر من صفر. | |
| Bande tarifaire introuvable pour ce centre. | الفترة السعرية غير موجودة لهذا المركز. | |
| weekday doit être entre 0 et 6. | يجب أن يكون weekday بين 0 و6. | |
| La fermeture doit suivre l’ouverture. | يجب أن يكون وقت الإغلاق بعد وقت الفتح. | |
| Aucune plage horaire à cette heure pour ce jour. | لا توجد فترة عمل في هذه الساعة لهذا اليوم. | |
| Vous n’avez pas le droit d’effectuer cette action. | ليست لديكم صلاحية القيام بهذا الإجراء. | |
| Ce match a été annulé : personne n’y est absent. | أُلغيت هذه المباراة: لا يوجد فيها أي غائب. | |
| Seul l’organisateur peut le déclarer. | وحده المنظّم يمكنه التصريح بذلك. | |
| L’organisateur ne peut pas se déclarer absent lui-même. | لا يمكن للمنظّم أن يصرّح بغيابه هو نفسه. | |
| Ce joueur n’était pas inscrit à ce match. | لم يكن هذا اللاعب مسجَّلًا في هذه المباراة. | |
| Un terrain propose au moins un format. | يقترح كل ملعب صيغة واحدة على الأقل. | |
| Le format {1} n’existe pas en {2}. | الصيغة {1} غير موجودة في {2}. | |
| L’ouverture doit être dans la journée (00:00–23:59). | يجب أن يكون وقت الفتح خلال اليوم (00:00–23:59). | |
| La fermeture ne peut pas dépasser le lendemain minuit. | لا يمكن أن يتجاوز وقت الإغلاق منتصف ليل اليوم التالي. | |
| Une réservation dure entre 30 minutes et 6 heures. | تتراوح مدة الحجز بين 30 دقيقة و6 ساعات. | |
| Ce créneau sort des horaires d’ouverture du centre. | هذا التوقيت خارج أوقات عمل المركز. | |
| Cette réservation ne peut plus être annulée. | لم يعد من الممكن إلغاء هذا الحجز. | |
| Le créneau a commencé : cette réservation ne peut plus être annulée. | بدأ التوقيت: لم يعد من الممكن إلغاء هذا الحجز. | |
| Passage {1} → {2} impossible. | الانتقال من «{1}» إلى «{2}» غير ممكن. | |
| Tu as déjà {1} réservations ce jour-là. C’est le maximum, pour laisser des créneaux à tout le monde. | عدد حجوزاتكم في ذلك اليوم: {1}. هذا هو الحد الأقصى، لترك توقيتات للجميع. | |
| Tu as déjà {1} réservations à venir. Joue-en une, ou annule celle dont tu n’as plus besoin, et tu pourras en prendre une autre. | عدد حجوزاتكم القادمة: {1}. العبوا إحداها، أو ألغوا ما لم تعودوا بحاجة إليه، وسيمكنكم بعدها أخذ حجز آخر. | |
| Cette réservation ne t’est pas rattachée. | هذا الحجز غير مرتبط بكم. | |
| Tu as déjà répondu pour cette réservation. | لقد أجبتم بالفعل بخصوص هذا الحجز. | |
| Cette réservation n’est plus d’actualité. | لم يعد هذا الحجز قائمًا. | |
| Ce créneau a déjà commencé. | لقد بدأ هذا التوقيت بالفعل. | |
| Action réservée au {1} du centre. | هذا الإجراء من صلاحيات {1} في المركز. | |
| La fin du blocage doit suivre son début. | يجب أن تكون نهاية الحجب بعد بدايته. | |
| Un code promo : 3 à 20 caractères, A–Z et chiffres. | الرمز الترويجي: من 3 إلى 20 حرفًا، من A إلى Z وأرقام. | |
| La remise va de 5 % à 50 %. | يتراوح التخفيض بين 5% و50%. | |
| La bande horaire de la promo est incohérente. | الفترة الزمنية للرمز الترويجي غير متناسقة. | |
| La fin de validité doit suivre le début. | يجب أن تكون نهاية الصلاحية بعد بدايتها. | |
| Choisis au moins un jour. | اختاروا يومًا واحدًا على الأقل. | |
| Le plafond d’utilisations est d’au moins 1. | الحد الأقصى لعدد الاستعمالات لا يقل عن 1. | |
| La durée minimum est d’au moins 30 minutes. | لا تقل المدة الدنيا عن 30 دقيقة. | |
| La priorité ne peut pas être négative. | لا يمكن أن تكون الأولوية سالبة. | |
| Seule une réservation encore à venir (réservée) peut être modifiée. | لا يمكن تعديل إلا حجز قادم (محجوز). | |
| La fin doit suivre le début. | يجب أن تكون النهاية بعد البداية. | |
| On ne déplace pas une réservation vers le passé. | لا يمكن نقل حجز إلى الماضي. | |
| Le fonds d’ouverture ne peut pas être négatif. | لا يمكن أن يكون رصيد الافتتاح سالبًا. | |
| La caisse est clôturée. | الصندوق مغلق. | |
| Un mouvement de caisse est toujours strictement positif. | حركة الصندوق دائمًا مبلغ أكبر من صفر. | |
| Cette caisse est déjà clôturée. | تم إغلاق هذا الصندوق مسبقًا. | |
| Trop de tentatives. Réessayez dans {1} min. | محاولات كثيرة جدًا. أعيدوا المحاولة بعد {1} د. | |
| Un centre « {1} » ne peut pas passer à « {2} ». | لا يمكن لمركز في حالة «{1}» أن ينتقل إلى «{2}». | |

### Morceaux insérés dans ces messages (rôles, statuts…)

| Français | Arabe (provisoire) | Correction |
|---|---|---|
| il est déjà publié | المركز منشور بالفعل | |
| il est suspendu — contactez Moubarat | المركز موقوف — اتصلوا بمبارات | |
| il n’a pas été retenu — contactez Moubarat | لم يُقبل المركز — اتصلوا بمبارات | |
| Réessayez | أعيدوا المحاولة | |
| Réessaie | أعيدوا المحاولة | |
| comptoir | في الشباك | |
| téléphonique | عبر الهاتف | |
| OWNER | المالك | |
| MANAGER | المدير | |
| RECEPTION | الاستقبال | |
| STAFF | عامل | |
| propriétaire | المالك | |
| manager | المدير | |
| personnel d’accueil (Réception) | موظفي الاستقبال | |
| RESERVED | محجوز | |
| HONORED | حاضر | |
| PAID | مدفوع | |
| NO_SHOW | غائب | |
| CANCELLED | ملغى | |
| PENDING | قيد الانتظار | |
| ACTIVE | منشور | |
| SUSPENDED | موقوف | |
| REJECTED | مرفوض | |
| football | كرة القدم | |
| padel | البادل | |
| basket | كرة السلة | |
| Nom du centre | اسم المركز | |
| Wilaya | الولاية | |
| Adresse | العنوان | |
| Nom du contact | اسم الشخص المسؤول | |
| Email | البريد الإلكتروني | |
| Téléphone | الهاتف | |
