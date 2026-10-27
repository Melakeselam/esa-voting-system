/* ESA Voting Mini App — in-app help: step-by-step scenarios per role, in English and Amharic.
   window.HELP.sections(role, lang) returns [{icon, title, body:[string | {steps} | {bullets} | {tip} | {warn}]}]. */
(function () {
  "use strict";

  var ADMIN = {
    en: [
      {
        icon: "🚀", title: "First-time setup (before the assembly)",
        body: [
          "Do this once, a few days before the General Assembly. Everything is on the Setup tab.",
          { steps: [
            "Open Setup and read the Health list. Every line should show ✅. If the webhook line shows ❌, tap “Register webhook, commands and menu button”.",
            "Add the bot to the assembly supergroup as an administrator. The group links itself and appears under “Assembly group & topics”.",
            "Post a short message in every topic (room) where announcements and results should go. Tap ↻ in Setup: the topics appear in the list. Rename any topic whose name was not captured.",
            "Add the other officials as admins: they send /whoami to the bot, you enter the ID under Admins → Add admin.",
            "Tap “Send a test message here” on one topic to confirm the bot can post in the group.",
          ] },
          { tip: "Run a full rehearsal with 2–3 test credentials: create a resolution, open it, vote, close it, and generate the report. Deactivate the test tokens afterwards." },
        ],
      },
      {
        icon: "🎫", title: "Issue credentials to members",
        body: [
          "Each voting member receives a Token ID and a password. The system stores only a hash, so the CSV you receive is the only copy.",
          { steps: [
            "Open Members and tap “＋ Credentials” at the top right.",
            "Choose “By names” and paste one member per line as “Full Name, Region”, or choose “By count” for anonymous tokens.",
            "Keep the token prefix (for example ESA-2026) or change it, then tap Generate.",
            "The bot sends a CSV file to your private chat. Print or distribute the credentials to the members in person, one slip each.",
            "Delete the CSV from your Telegram chat and from your device once distributed.",
          ] },
          { warn: "Never post the credentials file in a group. Anyone holding a token and password can vote as that member." },
        ],
      },
      {
        icon: "🏛", title: "Invitations per council (QR codes and PDF)",
        body: [
          "Use this instead of plain credentials when voting members are chosen by councils (regions, sections). Each council gets a fixed number of invitations; each invitation is one voting seat.",
          { steps: [
            "Members → “＋ Invitations” → “Add council”: enter the council name and the number of voting delegates (seats). Paste the delegate names one per line if you know them; leave the box empty for anonymous invitations the council assigns itself.",
            "Or tap “Import councils from Excel / CSV” and upload a sheet with the columns Council, Name, Seats (one row per delegate, or one row per council with a number of seats). Check the preview, then “Create councils and invitations”.",
            "The bot sends you one PDF per council: two invitations per A4 page, each with the council, the delegate, the invitation code, the password, a QR code and a link. Print it and cut along the dashed line, or forward the PDF to the council.",
            "The council hands one invitation to each chosen member. The member scans the QR code (or opens the link), taps Start, and enters the password: the code is already filled in.",
            "On the council page you see who has registered. “New passwords for unregistered delegates” renews the sheet if it was lost; registered delegates are not affected.",
          ] },
          { bullets: [
            "Invitation codes start with the council code (for example AARC-K7M2P). Delegates also appear under Members with the council as their region.",
            "A council can be deleted only before invitations are issued. Afterwards, deactivate unused invitations under Members.",
            "The PDF contains the passwords: delete it from your chat once the invitations are handed over.",
          ] },
          { tip: "Generate the invitations a week before the assembly and print them on thick paper; keep one unprinted copy of the PDF in a safe place for reissues." },
        ],
      },
      {
        icon: "📝", title: "How members register",
        body: [
          "Members register once; after that their Telegram account is linked to their token.",
          { steps: [
            "The member opens the bot in Telegram and taps the menu button (or sends /start).",
            "They enter their Token ID and password and tap Register.",
            "They now see the Vote tab with every open resolution.",
          ] },
          { bullets: [
            "Five wrong passwords lock a token for a while. You can unlock it: Members → tap the member → Unlock now.",
            "Lost phone or new Telegram account: Members → tap the member → “Detach Telegram account”. The member registers again with the same slip.",
            "“Already registered to another account” means someone else used that slip first. Detach and re-issue if needed.",
          ] },
        ],
      },
      {
        icon: "🗳", title: "Create a resolution",
        body: [
          { steps: [
            "Home → “＋ New resolution” (or Resolutions → ＋ New).",
            "Enter a title, an optional description shown on the ballot, and 2–12 options. Tap “＋ Abstain” to add an abstain option: it counts toward quorum but not toward the majority.",
            "Choose Secret ballot (choices stored without names, cannot be changed) or switch it off for an Open ballot (members may change their vote until closing).",
            "Set a quorum (minimum ballots for the vote to be valid) and the majority needed to adopt: simple majority or 2/3.",
            "Tap “Create draft”. Drafts can be edited or deleted until voting opens.",
          ] },
          { tip: "Prepare all resolutions as drafts before the assembly, then open them one by one during the session." },
        ],
      },
      {
        icon: "🟢", title: "Open voting and announce it",
        body: [
          { steps: [
            "Open the resolution and tap “Open voting”.",
            "Choose a deadline: no deadline (you close it manually), close automatically after N minutes, or close at a specific time.",
            "Confirm “Announce in a group topic now?” and pick the topic. The bot posts the resolution with a Vote button in that topic.",
            "Optional: “Send ballot to all members” sends every registered member a private message with the ballot.",
          ] },
          { bullets: [
            "Members can vote from the announcement button, from the private message, or by opening the Mini App.",
            "Members who never opened the bot cannot receive private messages. The announcement in the group still reaches them.",
          ] },
        ],
      },
      {
        icon: "⏱", title: "During voting",
        body: [
          { bullets: [
            "The resolution page shows interim results and the number of ballots cast. Tap ↻ to refresh.",
            "“Post interim results” publishes the current tally in a topic (for example before closing a debate).",
            "“Message all members” on Home sends a private broadcast, for example a reminder that voting closes in 10 minutes.",
            "A deadline is enforced by the server: the vote closes on time even if nobody is in the app.",
          ] },
        ],
      },
      {
        icon: "🔴", title: "Close voting and publish results",
        body: [
          { steps: [
            "Open the resolution and tap “Close voting now”, or wait for the deadline.",
            "Final results are posted automatically to the topic where the resolution was announced.",
            "Use “Post final results to a topic” to publish them in another topic as well.",
          ] },
          "The verdict follows the rules you set: quorum not reached means the vote is not valid; otherwise the leading option is adopted when it reaches the required majority (abstentions do not count toward it). A tie is not adopted.",
        ],
      },
      {
        icon: "📋", title: "Assembly report",
        body: [
          { steps: [
            "Home → “Assembly report”.",
            "Tap “Send report to my chat”. The bot sends a CSV (one row per option) and a print-ready HTML document with results, turnout and an integrity statement.",
            "If email is configured, “Send to my chat and email it” also mails the report to the National Office mailbox.",
          ] },
          { tip: "Generate the report right after the last resolution closes, while all officials are present." },
        ],
      },
      {
        icon: "👥", title: "Manage members and admins",
        body: [
          { bullets: [
            "Members: search by token, name or region; filter by registered, not registered, locked or deactivated.",
            "Deactivate a token when a member leaves or a slip is lost; reactivate it later if needed.",
            "Admins: Setup → Admins → Add admin with the person's Telegram ID (they get it by sending /whoami to the bot). Tap an admin to remove them.",
            "Admins listed “from ADMIN_TELEGRAM_IDS” are set on the server and cannot be removed here.",
          ] },
        ],
      },
      {
        icon: "🛠", title: "Troubleshooting",
        body: [
          { bullets: [
            "No topics in the picker: the bot has not seen a message there yet. Post in the topic and tap ↻, or add it by ID in Setup.",
            "The bot does not post in the group: make sure it is an administrator of the supergroup, then send a test message from Setup.",
            "Members do not receive private messages: they must open the bot and tap Start once.",
            "A member cannot register: check the token in Members (locked? deactivated? already registered?).",
            "Webhook ❌ in Health: tap “Register webhook, commands and menu button”. If it stays red, contact the technical administrator.",
            "Every admin action is recorded: Setup → Audit log.",
          ] },
        ],
      },
    ],
    am: [
      {
        icon: "🚀", title: "የመጀመሪያ ማዋቀር (ከጉባኤው በፊት)",
        body: [
          "ይህንን ከጠቅላላ ጉባኤው ጥቂት ቀናት በፊት አንድ ጊዜ ያድርጉ። ሁሉም ነገር በ«ማዋቀር» ትር ውስጥ ነው።",
          { steps: [
            "«ማዋቀር»ን ከፍተው የጤንነት ዝርዝሩን ያንብቡ። እያንዳንዱ መስመር ✅ ማሳየት አለበት። የዌብሁክ መስመሩ ❌ ካሳየ «ዌብሁክ፣ ትዕዛዞችን እና የምናሌ አዝራርን መዝግብ»ን ይንኩ።",
            "ቦቱን ወደ የጉባኤው ሱፐርግሩፕ እንደ አስተዳዳሪ ያክሉ። ቡድኑ በራሱ ይገናኛል እና በ«የጉባኤ ቡድን እና ርዕሶች» ስር ይታያል።",
            "ማስታወቂያዎችና ውጤቶች በሚለጠፉበት እያንዳንዱ ርዕስ (ክፍል) ውስጥ አጭር መልዕክት ይለጥፉ። በ«ማዋቀር» ውስጥ ↻ን ይንኩ፤ ርዕሶቹ በዝርዝሩ ውስጥ ይታያሉ። ስሙ ያልተያዘ ርዕስ ካለ እንደገና ይሰይሙት።",
            "ሌሎቹን ባለሥልጣናት እንደ አስተዳዳሪ ያክሉ፦ እነሱ ለቦቱ /whoami ይልካሉ፣ እርስዎ መታወቂያውን በ«አስተዳዳሪዎች» → «አስተዳዳሪ አክል» ውስጥ ያስገባሉ።",
            "ቦቱ በቡድኑ ውስጥ መለጠፍ እንደሚችል ለማረጋገጥ በአንድ ርዕስ ላይ «እዚህ የሙከራ መልዕክት ላክ»ን ይንኩ።",
          ] },
          { tip: "በ2–3 የሙከራ መግቢያዎች ሙሉ ልምምድ ያድርጉ፦ የውሳኔ ሀሳብ ይፍጠሩ፣ ይክፈቱ፣ ድምፅ ይስጡ፣ ይዝጉ እና ሪፖርቱን ያመንጩ። ከዚያ በኋላ የሙከራ ቶከኖቹን ያቦዝኑ።" },
        ],
      },
      {
        icon: "🎫", title: "ለአባላት የመግቢያ መረጃ መስጠት",
        body: [
          "እያንዳንዱ ድምፅ ሰጪ አባል የቶከን መታወቂያ እና የይለፍ ቃል ይቀበላል። ሥርዓቱ ሃሽ ብቻ ስለሚያስቀምጥ የሚደርስዎት CSV ፋይል ብቸኛው ቅጂ ነው።",
          { steps: [
            "«አባላት»ን ከፍተው ከላይ በቀኝ ያለውን «＋ የመግቢያ መረጃ»ን ይንኩ።",
            "«በስም» የሚለውን መርጠው በእያንዳንዱ መስመር አንድ አባል «ሙሉ ስም፣ ክልል» ብለው ይለጥፉ፤ ወይም ስም የሌላቸው ቶከኖች ለማግኘት «በቁጥር»ን ይምረጡ።",
            "የቶከን ቅድመ ቅጥያውን (ለምሳሌ ESA-2026) ያቆዩ ወይም ይቀይሩ፣ ከዚያ «አመንጭ»ን ይንኩ።",
            "ቦቱ CSV ፋይል ወደ የግል ቻትዎ ይልካል። የመግቢያ መረጃውን አትመው ወይም በአካል ለአባላቱ ያከፋፍሉ፣ ለእያንዳንዱ አንድ ወረቀት።",
            "ካከፋፈሉ በኋላ CSV ፋይሉን ከቴሌግራም ቻትዎ እና ከመሣሪያዎ ይሰርዙ።",
          ] },
          { warn: "የመግቢያ መረጃ ፋይሉን በቡድን ውስጥ በፍጹም አይለጥፉ። ቶከንና የይለፍ ቃል ያለው ማንኛውም ሰው በዚያ አባል ስም ድምፅ መስጠት ይችላል።" },
        ],
      },
      {
        icon: "🏛", title: "በምክር ቤት ጥሪዎች (QR ኮዶች እና PDF)",
        body: [
          "ድምፅ ሰጪ አባላት በምክር ቤቶች (ክልሎች፣ ክፍሎች) ሲመረጡ ከተራ የመግቢያ መረጃ ይልቅ ይህንን ይጠቀሙ። እያንዳንዱ ምክር ቤት የተወሰነ ቁጥር ያላቸው ጥሪዎች ያገኛል፤ እያንዳንዱ ጥሪ አንድ የድምፅ መቀመጫ ነው።",
          { steps: [
            "«አባላት» → «＋ ጥሪዎች» → «ምክር ቤት አክል»፦ የምክር ቤቱን ስም እና የድምፅ ሰጪ ተወካዮች ብዛት (መቀመጫዎች) ያስገቡ። ስሞቹን ካወቁ በእያንዳንዱ መስመር አንድ ተወካይ ይለጥፉ፤ ምክር ቤቱ ራሱ የሚያከፋፍላቸው ስም-አልባ ጥሪዎች ከፈለጉ ሳጥኑን ባዶ ይተውት።",
            "ወይም «ምክር ቤቶችን ከኤክሴል / CSV አስመጣ»ን ነክተው ምክር ቤት፣ ስም፣ መቀመጫዎች የሚሉ አምዶች ያሉት ሰንጠረዥ ይስቀሉ (በእያንዳንዱ ተወካይ አንድ ረድፍ፣ ወይም በእያንዳንዱ ምክር ቤት የመቀመጫ ብዛት ያለው አንድ ረድፍ)። ቅድመ እይታውን ይመልከቱ፣ ከዚያ «ምክር ቤቶች እና ጥሪዎች ፍጠር»።",
            "ቦቱ ለእያንዳንዱ ምክር ቤት አንድ PDF ይልክልዎታል፦ በእያንዳንዱ A4 ገጽ ሁለት ጥሪዎች፣ እያንዳንዱ ምክር ቤቱን፣ ተወካዩን፣ የጥሪ ኮዱን፣ የይለፍ ቃሉን፣ QR ኮድ እና አገናኝ የያዘ። አትመው በነጥብ መስመሩ ይቁረጡ፣ ወይም PDFውን ለምክር ቤቱ ያስተላልፉ።",
            "ምክር ቤቱ ለእያንዳንዱ የተመረጠ አባል አንድ ጥሪ ይሰጣል። አባሉ QR ኮዱን ይቃኛል (ወይም አገናኙን ይከፍታል)፣ Start ይነካል፣ እና የይለፍ ቃሉን ያስገባል፤ ኮዱ አስቀድሞ ተሞልቷል።",
            "በምክር ቤቱ ገጽ ላይ ማን እንደተመዘገበ ያያሉ። «ላልተመዘገቡ ተወካዮች አዲስ የይለፍ ቃላት» ወረቀቱ ከጠፋ ያድሰዋል፤ የተመዘገቡ ተወካዮች አይነኩም።",
          ] },
          { bullets: [
            "የጥሪ ኮዶች በምክር ቤቱ ኮድ ይጀምራሉ (ለምሳሌ AARC-K7M2P)። ተወካዮች ምክር ቤቱ እንደ ክልላቸው ሆኖ በ«አባላት» ስርም ይታያሉ።",
            "ምክር ቤት ሊሰረዝ የሚችለው ጥሪዎች ከመሰጠታቸው በፊት ብቻ ነው። ከዚያ በኋላ ያልተጠቀሙባቸውን ጥሪዎች በ«አባላት» ስር ያቦዝኑ።",
            "PDFው የይለፍ ቃላቱን ይዟል፦ ጥሪዎቹ ከተሰጡ በኋላ ከቻትዎ ይሰርዙት።",
          ] },
          { tip: "ጥሪዎቹን ከጉባኤው አንድ ሳምንት በፊት አመንጭተው በወፍራም ወረቀት ያትሙ፤ ለድጋሚ ስርጭት አንድ ያልታተመ የPDF ቅጂ በደህና ቦታ ያስቀምጡ።" },
        ],
      },
      {
        icon: "📝", title: "አባላት እንዴት ይመዘገባሉ",
        body: [
          "አባላት አንድ ጊዜ ይመዘገባሉ፤ ከዚያ በኋላ የቴሌግራም መለያቸው ከቶከናቸው ጋር ይገናኛል።",
          { steps: [
            "አባሉ ቦቱን በቴሌግራም ከፍቶ የምናሌ አዝራሩን ይነካል (ወይም /start ይልካል)።",
            "የቶከን መታወቂያውንና የይለፍ ቃሉን አስገብቶ «ይመዝገቡ»ን ይነካል።",
            "አሁን ሁሉንም ክፍት የውሳኔ ሀሳቦች የያዘውን «ድምፅ ይስጡ» ትር ያያል።",
          ] },
          { bullets: [
            "አምስት የተሳሳቱ የይለፍ ቃላት ቶከኑን ለተወሰነ ጊዜ ይቆልፋሉ። መክፈት ይችላሉ፦ «አባላት» → አባሉን ይንኩ → «አሁን ክፈት»።",
            "ስልክ ከጠፋ ወይም አዲስ የቴሌግራም መለያ ካለ፦ «አባላት» → አባሉን ይንኩ → «የቴሌግራም መለያ ንቀል»። አባሉ በዚያው ወረቀት እንደገና ይመዘገባል።",
            "«አስቀድሞ በሌላ መለያ ተመዝግቧል» ማለት ሌላ ሰው ያንን ወረቀት መጀመሪያ ተጠቅሞበታል ማለት ነው። አስፈላጊ ከሆነ ንቅለው እንደገና ይስጡ።",
          ] },
        ],
      },
      {
        icon: "🗳", title: "የውሳኔ ሀሳብ መፍጠር",
        body: [
          { steps: [
            "«መነሻ» → «＋ አዲስ የውሳኔ ሀሳብ» (ወይም «የውሳኔ ሀሳቦች» → ＋ አዲስ)።",
            "ርዕስ፣ በድምፅ መስጫው ላይ የሚታይ አማራጭ መግለጫ፣ እና ከ2 እስከ 12 አማራጮች ያስገቡ። «＋ ድምፀ ተአቅቦ»ን ይንኩ፤ ይህ አማራጭ ለምልዓተ ጉባኤ ይቆጠራል ነገር ግን ለአብላጫ ድምፅ አይቆጠርም።",
            "«ሚስጥራዊ ድምፅ» ይምረጡ (ምርጫዎች ያለ ስም ይቀመጣሉ እና ሊቀየሩ አይችሉም) ወይም ለ«ግልጽ ድምፅ» ያጥፉት (አባላት እስኪዘጋ ድረስ ድምፃቸውን መቀየር ይችላሉ)።",
            "ምልዓተ ጉባኤ (ድምፁ ትክክለኛ እንዲሆን ዝቅተኛው የድምፅ ብዛት) እና ለማጽደቅ የሚያስፈልገውን አብላጫ ድምፅ ያስቀምጡ፦ ተራ አብላጫ ወይም 2/3።",
            "«ረቂቅ ፍጠር»ን ይንኩ። ረቂቆች ድምፅ መስጠት እስኪከፈት ድረስ ሊስተካከሉ ወይም ሊሰረዙ ይችላሉ።",
          ] },
          { tip: "ሁሉንም የውሳኔ ሀሳቦች ከጉባኤው በፊት እንደ ረቂቅ ያዘጋጁ፣ ከዚያ በስብሰባው ወቅት አንድ በአንድ ይክፈቱ።" },
        ],
      },
      {
        icon: "🟢", title: "ድምፅ መስጠትን መክፈት እና ማሳወቅ",
        body: [
          { steps: [
            "የውሳኔ ሀሳቡን ከፍተው «ድምፅ መስጠትን ክፈት»ን ይንኩ።",
            "የመዝጊያ ሰዓት ይምረጡ፦ ያለ መዝጊያ ሰዓት (እራስዎ ይዘጋሉ)፣ ከN ደቂቃ በኋላ በራስ-ሰር ይዘጋል፣ ወይም በተወሰነ ሰዓት ይዘጋል።",
            "«አሁን በቡድን ርዕስ ውስጥ ይታወቅ?» የሚለውን ያረጋግጡና ርዕሱን ይምረጡ። ቦቱ የውሳኔ ሀሳቡን ከ«ድምፅ ይስጡ» አዝራር ጋር በዚያ ርዕስ ውስጥ ይለጥፋል።",
            "አማራጭ፦ «ድምፅ መስጫ ለሁሉም አባላት ላክ» ለእያንዳንዱ የተመዘገበ አባል የድምፅ መስጫውን በግል መልዕክት ይልካል።",
          ] },
          { bullets: [
            "አባላት ከማስታወቂያው አዝራር፣ ከግል መልዕክቱ፣ ወይም ሚኒ አፑን በመክፈት ድምፅ መስጠት ይችላሉ።",
            "ቦቱን በፍጹም ያልከፈቱ አባላት የግል መልዕክት መቀበል አይችሉም። በቡድኑ ውስጥ ያለው ማስታወቂያ ግን ይደርሳቸዋል።",
          ] },
        ],
      },
      {
        icon: "⏱", title: "በድምፅ መስጠት ወቅት",
        body: [
          { bullets: [
            "የውሳኔ ሀሳቡ ገጽ ጊዜያዊ ውጤቶችንና የተሰጡ ድምፆችን ብዛት ያሳያል። ለማደስ ↻ን ይንኩ።",
            "«ጊዜያዊ ውጤቶችን ለጥፍ» የአሁኑን ቆጠራ በአንድ ርዕስ ውስጥ ያትማል (ለምሳሌ ክርክር ከመዝጋቱ በፊት)።",
            "በ«መነሻ» ላይ ያለው «ለሁሉም አባላት መልዕክት ላክ» የግል መልዕክት ለሁሉም ይልካል፣ ለምሳሌ ድምፅ መስጠት በ10 ደቂቃ ውስጥ እንደሚዘጋ ማስታወሻ።",
            "የመዝጊያ ሰዓቱ በአገልጋዩ ይተገበራል፦ ማንም በመተግበሪያው ውስጥ ባይኖርም ድምፁ በሰዓቱ ይዘጋል።",
          ] },
        ],
      },
      {
        icon: "🔴", title: "ድምፅ መስጠትን መዝጋት እና ውጤቶችን ማተም",
        body: [
          { steps: [
            "የውሳኔ ሀሳቡን ከፍተው «ድምፅ መስጠትን አሁን ዝጋ»ን ይንኩ፣ ወይም የመዝጊያ ሰዓቱን ይጠብቁ።",
            "የመጨረሻ ውጤቶች የውሳኔ ሀሳቡ በታወቀበት ርዕስ ውስጥ በራስ-ሰር ይለጠፋሉ።",
            "በሌላ ርዕስ ውስጥም ለማተም «የመጨረሻ ውጤቶችን ወደ ርዕስ ለጥፍ»ን ይጠቀሙ።",
          ] },
          "ፍርዱ እርስዎ ያስቀመጧቸውን ሕጎች ይከተላል፦ ምልዓተ ጉባኤ ካልተሟላ ድምፁ ትክክለኛ አይደለም፤ አለበለዚያ ቀዳሚው አማራጭ የሚያስፈልገውን አብላጫ ድምፅ ሲያገኝ ይጸድቃል (ድምፀ ተአቅቦ ለዚህ አይቆጠርም)። እኩል ድምፅ አይጸድቅም።",
        ],
      },
      {
        icon: "📋", title: "የጉባኤ ሪፖርት",
        body: [
          { steps: [
            "«መነሻ» → «የጉባኤ ሪፖርት»።",
            "«ሪፖርቱን ወደ ቻቴ ላክ»ን ይንኩ። ቦቱ CSV (በእያንዳንዱ አማራጭ አንድ ረድፍ) እና ውጤቶች፣ ተሳትፎ እና የታማኝነት መግለጫ የያዘ ለህትመት ዝግጁ HTML ሰነድ ይልካል።",
            "ኢሜይል ከተዋቀረ «ወደ ቻቴ ላክ እና በኢሜይል ላክ» ሪፖርቱን ወደ ብሔራዊ ጽሕፈት ቤቱ የኢሜይል ሳጥንም ይልካል።",
          ] },
          { tip: "ሁሉም ባለሥልጣናት በተገኙበት፣ የመጨረሻው የውሳኔ ሀሳብ እንደተዘጋ ወዲያውኑ ሪፖርቱን ያመንጩ።" },
        ],
      },
      {
        icon: "👥", title: "አባላትን እና አስተዳዳሪዎችን ማስተዳደር",
        body: [
          { bullets: [
            "አባላት፦ በቶከን፣ በስም ወይም በክልል ይፈልጉ፤ በተመዘገበ፣ ባልተመዘገበ፣ በተቆለፈ ወይም በቦዘነ ያጣሩ።",
            "አባል ሲለቅ ወይም ወረቀት ሲጠፋ ቶከኑን ያቦዝኑ፤ አስፈላጊ ከሆነ በኋላ እንደገና ያስነሱት።",
            "አስተዳዳሪዎች፦ «ማዋቀር» → «አስተዳዳሪዎች» → «አስተዳዳሪ አክል» በሰውዬው የቴሌግራም መታወቂያ (ለቦቱ /whoami በመላክ ያገኙታል)። አስተዳዳሪን ለማስወገድ ይንኩት።",
            "«ከ ADMIN_TELEGRAM_IDS» ተብለው የተዘረዘሩ አስተዳዳሪዎች በአገልጋዩ ላይ የተቀመጡ ናቸው እና እዚህ ሊወገዱ አይችሉም።",
          ] },
        ],
      },
      {
        icon: "🛠", title: "ችግር መፍታት",
        body: [
          { bullets: [
            "በመራጩ ውስጥ ርዕሶች የሉም፦ ቦቱ እስካሁን እዚያ መልዕክት አላየም። በርዕሱ ውስጥ ይለጥፉና ↻ን ይንኩ፣ ወይም በ«ማዋቀር» ውስጥ በመታወቂያ ያክሉት።",
            "ቦቱ በቡድኑ ውስጥ አይለጥፍም፦ የሱፐርግሩፑ አስተዳዳሪ መሆኑን ያረጋግጡ፣ ከዚያ ከ«ማዋቀር» የሙከራ መልዕክት ይላኩ።",
            "አባላት የግል መልዕክት አይደርሳቸውም፦ ቦቱን ከፍተው አንድ ጊዜ «Start»ን መንካት አለባቸው።",
            "አባል መመዝገብ አይችልም፦ ቶከኑን በ«አባላት» ውስጥ ይመልከቱ (ተቆልፏል? ቦዝኗል? አስቀድሞ ተመዝግቧል?)።",
            "በጤንነት ውስጥ ዌብሁክ ❌፦ «ዌብሁክ፣ ትዕዛዞችን እና የምናሌ አዝራርን መዝግብ»ን ይንኩ። ቀይ ሆኖ ከቀጠለ የቴክኒክ አስተዳዳሪውን ያነጋግሩ።",
            "እያንዳንዱ የአስተዳዳሪ ተግባር ይመዘገባል፦ «ማዋቀር» → «የኦዲት መዝገብ»።",
          ] },
        ],
      },
    ],
  };

  var MEMBER = {
    en: [
      {
        icon: "📝", title: "Register with your credentials",
        body: [
          "You need the credential slip from the National Office: a Token ID (like ESA-2026-K7M2P) and a password.",
          { steps: [
            "Open the voting bot in Telegram and tap the menu button next to the message box (or send /start).",
            "Type your Token ID and password exactly as printed. The letters O/0 and I/1 are never used in tokens.",
            "Tap Register. You only do this once; your Telegram account is now linked to your token.",
          ] },
          { bullets: [
            "Five wrong passwords lock the token for a while. Wait, or ask the National Office to unlock it.",
            "Keep your slip private. Anyone with it could vote in your name.",
          ] },
        ],
      },
      {
        icon: "🎫", title: "Register with a printed invitation (QR code)",
        body: [
          "If your council gave you a printed invitation, it carries a QR code, an invitation code and a password.",
          { steps: [
            "Scan the QR code with your phone camera (or open the link printed under it). Telegram opens the voting bot.",
            "Tap Start. The bot replies that it recognised your invitation code.",
            "Either send the password in the chat (the message is deleted right after checking) or tap “Register in the app”: the code is already filled in, enter the password and tap Register.",
          ] },
          { bullets: [
            "One invitation registers one Telegram account. If the bot says the invitation is already registered, contact your council or the National Office.",
            "Keep the invitation private: anyone holding it could vote in your place.",
          ] },
        ],
      },
      {
        icon: "🗳", title: "Cast your vote",
        body: [
          { steps: [
            "Open the Vote tab. Every resolution that is open for voting is listed with its options.",
            "Tap the option you choose and confirm.",
            "On a secret ballot your choice is stored without your name and is final. On an open ballot you may tap another option to change your vote until voting closes.",
          ] },
          { bullets: [
            "You can also vote from the announcement in the group topic or from the private message the bot sends you: both open the same ballot.",
            "The closing time is shown on each ballot. After it passes, voting is closed and your vote can no longer be changed.",
          ] },
        ],
      },
      {
        icon: "📊", title: "See the results",
        body: [
          { bullets: [
            "The Results tab lists every closed resolution with the outcome: adopted, not adopted, or quorum not reached.",
            "Tap a resolution to see the count per option.",
            "Final results are also posted in the assembly group topic when voting closes.",
          ] },
        ],
      },
      {
        icon: "📱", title: "Lost phone or new Telegram account",
        body: [
          "Your token is linked to one Telegram account. If you change phone or account, ask the National Office to detach your token. You then register again with the same credential slip.",
        ],
      },
      {
        icon: "🌐", title: "Change the language",
        body: [
          "Tap the language button at the top right of any screen to switch between English and Amharic. The choice is remembered on this device.",
        ],
      },
    ],
    am: [
      {
        icon: "📝", title: "በመግቢያ መረጃዎ መመዝገብ",
        body: [
          "ከብሔራዊ ጽሕፈት ቤት የተሰጠዎት የመግቢያ ወረቀት ያስፈልግዎታል፦ የቶከን መታወቂያ (እንደ ESA-2026-K7M2P) እና የይለፍ ቃል።",
          { steps: [
            "የድምፅ መስጫ ቦቱን በቴሌግራም ከፍተው ከመልዕክት ሳጥኑ አጠገብ ያለውን የምናሌ አዝራር ይንኩ (ወይም /start ይላኩ)።",
            "የቶከን መታወቂያዎንና የይለፍ ቃልዎን በትክክል እንደተጻፈው ይተይቡ። ፊደላቱ O/0 እና I/1 በቶከኖች ውስጥ በፍጹም አይጠቀሙም።",
            "«ይመዝገቡ»ን ይንኩ። ይህንን አንድ ጊዜ ብቻ ያደርጋሉ፤ የቴሌግራም መለያዎ አሁን ከቶከንዎ ጋር ተገናኝቷል።",
          ] },
          { bullets: [
            "አምስት የተሳሳቱ የይለፍ ቃላት ቶከኑን ለተወሰነ ጊዜ ይቆልፋሉ። ይጠብቁ፣ ወይም ብሔራዊ ጽሕፈት ቤቱ እንዲከፍትልዎ ይጠይቁ።",
            "ወረቀትዎን በግል ያስቀምጡ። ያለው ማንኛውም ሰው በእርስዎ ስም ድምፅ መስጠት ይችላል።",
          ] },
        ],
      },
      {
        icon: "🎫", title: "በታተመ ጥሪ (QR ኮድ) መመዝገብ",
        body: [
          "ምክር ቤትዎ የታተመ ጥሪ ከሰጠዎት፣ QR ኮድ፣ የጥሪ ኮድ እና የይለፍ ቃል ይዟል።",
          { steps: [
            "QR ኮዱን በስልክዎ ካሜራ ይቃኙ (ወይም ከሥሩ የታተመውን አገናኝ ይክፈቱ)። ቴሌግራም የድምፅ መስጫ ቦቱን ይከፍታል።",
            "Start ይንኩ። ቦቱ የጥሪ ኮድዎን እንዳወቀ ይመልስልዎታል።",
            "የይለፍ ቃሉን በቻቱ ውስጥ ይላኩ (መልዕክቱ ከተፈተሸ በኋላ ወዲያውኑ ይሰረዛል) ወይም «በመተግበሪያው ይመዝገቡ»ን ይንኩ፦ ኮዱ አስቀድሞ ተሞልቷል፣ የይለፍ ቃሉን አስገብተው «ይመዝገቡ»ን ይንኩ።",
          ] },
          { bullets: [
            "አንድ ጥሪ አንድ የቴሌግራም መለያ ይመዘግባል። ቦቱ ጥሪው አስቀድሞ ተመዝግቧል ካለ፣ ምክር ቤትዎን ወይም ብሔራዊ ጽሕፈት ቤቱን ያነጋግሩ።",
            "ጥሪውን በግል ያስቀምጡ፦ የያዘው ማንኛውም ሰው በእርስዎ ምትክ ድምፅ መስጠት ይችላል።",
          ] },
        ],
      },
      {
        icon: "🗳", title: "ድምፅዎን መስጠት",
        body: [
          { steps: [
            "«ድምፅ ይስጡ» ትርን ይክፈቱ። ለድምፅ ክፍት የሆነ እያንዳንዱ የውሳኔ ሀሳብ ከአማራጮቹ ጋር ተዘርዝሯል።",
            "የሚመርጡትን አማራጭ ነክተው ያረጋግጡ።",
            "በሚስጥራዊ ድምፅ ምርጫዎ ያለ ስምዎ ይቀመጣል እና የመጨረሻ ነው። በግልጽ ድምፅ ድምፅ መስጠት እስኪዘጋ ድረስ ድምፅዎን ለመቀየር ሌላ አማራጭ መንካት ይችላሉ።",
          ] },
          { bullets: [
            "ከቡድኑ ርዕስ ማስታወቂያ ወይም ቦቱ ከሚልክልዎ የግል መልዕክትም ድምፅ መስጠት ይችላሉ፤ ሁለቱም ያንኑ የድምፅ መስጫ ይከፍታሉ።",
            "የመዝጊያ ሰዓቱ በእያንዳንዱ የድምፅ መስጫ ላይ ይታያል። ካለፈ በኋላ ድምፅ መስጠት ተዘግቷል እና ድምፅዎ ሊቀየር አይችልም።",
          ] },
        ],
      },
      {
        icon: "📊", title: "ውጤቶችን ማየት",
        body: [
          { bullets: [
            "«ውጤቶች» ትር እያንዳንዱን የተዘጋ የውሳኔ ሀሳብ ከውጤቱ ጋር ይዘረዝራል፦ ጸድቋል፣ አልጸደቀም፣ ወይም ምልዓተ ጉባኤ አልተሟላም።",
            "የእያንዳንዱን አማራጭ ቆጠራ ለማየት የውሳኔ ሀሳብን ይንኩ።",
            "የመጨረሻ ውጤቶች ድምፅ መስጠት ሲዘጋ በጉባኤው ቡድን ርዕስ ውስጥም ይለጠፋሉ።",
          ] },
        ],
      },
      {
        icon: "📱", title: "ስልክ ከጠፋ ወይም አዲስ የቴሌግራም መለያ ካለ",
        body: [
          "ቶከንዎ ከአንድ የቴሌግራም መለያ ጋር ተገናኝቷል። ስልክ ወይም መለያ ከቀየሩ፣ ብሔራዊ ጽሕፈት ቤቱ ቶከንዎን እንዲነቅል ይጠይቁ። ከዚያ በዚያው የመግቢያ ወረቀት እንደገና ይመዘገባሉ።",
        ],
      },
      {
        icon: "🌐", title: "ቋንቋ መቀየር",
        body: [
          "በእንግሊዝኛ እና በአማርኛ መካከል ለመቀያየር በማንኛውም ማያ ገጽ ላይ ከላይ በቀኝ ያለውን የቋንቋ አዝራር ይንኩ። ምርጫው በዚህ መሣሪያ ላይ ይታወሳል።",
        ],
      },
    ],
  };

  window.HELP = {
    /** role: "admin" | "member" | "guest"; lang: "en" | "am". Admins get both guides. */
    sections: function (role, lang) {
      var L = lang === "am" ? "am" : "en";
      if (role === "admin") return ADMIN[L].concat([{ icon: "🙋", title: L === "am" ? "ለአባላት፦ መመዝገብ እና ድምፅ መስጠት" : "For members: registering and voting", body: [L === "am" ? "አባላት በመተግበሪያው ውስጥ የሚያዩት መመሪያ ይህ ነው።" : "This is the guide members see in the app."] }]).concat(MEMBER[L]);
      if (role === "member") return MEMBER[L];
      return MEMBER[L].slice(0, 2).concat(MEMBER[L].slice(5));
    },
  };
})();
