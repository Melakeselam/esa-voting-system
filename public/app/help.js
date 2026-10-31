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
            "Post a short message in every topic (room) where announcements and results should go. Tap ↻ in Setup: the topics appear in the list. Rename any topic whose name was not captured; when the bot has the “Manage topics” admin right, the topic is renamed in the group too.",
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
        icon: "🧾", title: "Members who vote for themselves (no councils)",
        body: [
          "Some organisations have no councils or chapters: every member votes for themselves, as in a share company or a professional association. Choose “Directly — every member votes for themselves” under Setup › Edit organisation › How members vote.",
          { steps: [
            "Members → “＋ Add members”.",
            "One member per line: a name, a phone number, or both — and the number of votes if members carry several (for example shares). Or upload a CSV or Excel file with name, phone and votes columns.",
            "Tap “Issue invitations”, then send one PDF per member (or one PDF with all) to your chat and hand each invitation to its member.",
            "To change a member's votes later, tap the member → “Change votes (shares)”. It applies to ballots cast from then on.",
          ] },
          { tip: "Majorities count votes (shares); the quorum counts the members who cast a ballot." },
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
          "Vote weight. Each council also has a number of votes per delegate (default 1). A council with 6 delegates at 1 vote each and a council with 3 delegates at 2 votes each both carry 6 votes. Set it when creating the council, in the Seats/Votes fields, or in the import sheet's last column; change it later with Edit on the council page (it applies to all its delegates from their next ballot on).",
          "How it counts. The weight is stamped on each ballot when it is cast, so secret ballots stay anonymous. Results, posted tallies and the report show the ballots cast (people) and, when they differ, the votes counted (weighted). Majorities are computed on votes; quorum is the number of ballots (delegates who voted).",
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
            "Set a quorum (the percentage of eligible members who must cast a ballot for the vote to be valid; it becomes a number of ballots from the active member count when voting closes) and the majority needed to adopt: simple majority or 2/3.",
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
            "A 4-digit activation code appears with the resolution title. Tap “Copy title and code” and paste it in the video-call chat (Zoom, Google Meet, Telegram call), or show it on the screen in the hall — never in the assembly group. Members must enter it before they can vote, which proves they are in the meeting. The code stays on the resolution page; “New code” replaces it if it leaks. Switch “Require activation code” off on the draft for votes that do not need it.",
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
            "If the deadline passes before quorum is reached (abstentions count), voting stays open: the resolution shows “Deadline passed without quorum”, every admin gets a message, and delegates who have not voted get one reminder. Choose “Extend voting…” (any number of minutes), “Close as not valid”, or “Close and redo” (closes it and prepares the same resolution as a new draft). If quorum is reached meanwhile, it closes by itself.",
            "Final results are posted automatically to the topic where the resolution was announced.",
            "Use “Post final results to a topic” to publish them in another topic as well.",
            "Closed too early or by mistake? Tap “Reopen voting” on the closed resolution and choose a new deadline (or none). Ballots already cast are kept, members who have not voted can vote, and the final results are published again when it closes.",
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
            "Renaming a topic in the app did not change it in the group: the bot lacks the “Manage topics” right. Grant it in the group's administrator settings, then save the name again.",
            "Setup still shows a group the bot was removed from: tap ↻. The app checks the bot's membership and unlinks the group; “Unlink group” does the same by hand.",
            "A topic does not appear after you post in it: open Health at the top of Setup and read “Last update from Telegram”. If that line does not change after you post, Telegram is not delivering updates to this server — register the webhook again from Setup.",
            "The test group was deleted and a new one created: when the bot is removed from the linked group it forgets the group and offers the admins, by private message, to wipe the assembly data (councils, members, invitations, resolutions and ballots) with a second confirmation tap, so the new group starts clean and no council or member name clashes with leftovers. Setup › “Reset assembly data” does the same, and a switch there makes the wipe automatic on removal — only turn that on if an accidental removal of the bot is acceptable.",
            "Where do members sign in? In the group, the bot keeps a “📝 Register / Sign in” topic with a pinned card (created when the bot became admin; “Post sign-in topic” in Setup re-posts it). The “Register with your code” button takes the member to a private chat with the bot, where they enter their invitation code and password out of everyone's sight. Nothing is typed in the group itself.",
            "Someone is in the group without being registered: Setup › “People in the group” lists everyone the bot has seen who is not a registered member or admin. Tap the person to register them (name, council, role — their Telegram account is linked at once, no code needed), approve or decline their join request, or remove them. Switch on “Remove unregistered people automatically” to have the bot remove anyone who joins without registering. Telegram gives bots no member list, so people already inside appear only once they post or rejoin.",
            "Ordinary members can add people, rename the group, pin messages or create topics: Telegram switches all of these on for new groups. The bot turns them off the moment it is made an administrator with the “Ban users” right; Setup shows “Member permissions: locked”. If it says members can still do something, give the bot that right and tap “Lock group for members”, or change Permissions in the group by hand.",
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
            "ማስታወቂያዎችና ውጤቶች በሚለጠፉበት እያንዳንዱ ርዕስ (ክፍል) ውስጥ አጭር መልዕክት ይለጥፉ። በ«ማዋቀር» ውስጥ ↻ን ይንኩ፤ ርዕሶቹ በዝርዝሩ ውስጥ ይታያሉ። ስሙ ያልተያዘ ርዕስ ካለ እንደገና ይሰይሙት፤ ቦቱ የ«ርዕሶችን አስተዳድር» የአስተዳዳሪ መብት ካለው ርዕሱ በቡድኑ ውስጥም ይቀየራል።",
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
        icon: "🧾", title: "ለራሳቸው ድምፅ የሚሰጡ አባላት (ያለ መሀል አካል)",
        body: [
          "አንዳንድ ድርጅቶች ቅርንጫፎች የላቸውም፦ እንደ አክሲዮን ማኅበር ወይም የሙያ ማኅበር እያንዳንዱ አባል ለራሱ ድምፅ ይሰጣል። በ«ማዋቀር» › «ድርጅቱን አስተካክል» › «አባላት እንዴት ድምፅ ይሰጣሉ» ስር «በቀጥታ — እያንዳንዱ አባል ለራሱ ድምፅ ይሰጣል»ን ይምረጡ።",
          { steps: [
            "«አባላት» → «＋ አባላት አክል»።",
            "በአንድ መስመር አንድ አባል፦ ስም፣ ስልክ ቁጥር፣ ወይም ሁለቱም — አባላት ብዙ ድምፅ ካላቸው (ለምሳሌ አክሲዮን) የድምፅ ብዛቱ። ወይም ስም፣ ስልክ እና ድምፆች አምዶች ያሉት CSV ወይም Excel ፋይል ይጫኑ።",
            "«ግብዣዎችን ስጥ»ን ይንኩ፣ ከዚያ ለእያንዳንዱ አባል አንድ PDF (ወይም ሁሉንም የያዘ አንድ PDF) ወደ ቻትዎ ይላኩ እና እያንዳንዱን ግብዣ ለባለቤቱ ይስጡ።",
            "የአንድን አባል ድምፆች በኋላ ለመቀየር አባሉን ይንኩ → «የድምፅ ብዛት ቀይር (አክሲዮን)»። ከዚያ በኋላ ለሚሰጡ ድምፆች ይሠራል።",
          ] },
          { tip: "አብላጫ ድምፅ ድምፆችን (አክሲዮኖችን) ይቆጥራል፤ ምልዓተ ጉባኤ ድምፅ የሰጡ አባላትን ይቆጥራል።" },
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
          "የድምፅ ክብደት። እያንዳንዱ ምክር ቤት በእያንዳንዱ ተወካይ የድምፅ ብዛትም አለው (ነባሪ 1)። እያንዳንዳቸው 1 ድምፅ ያላቸው 6 ተወካዮች ያሉት ምክር ቤት እና እያንዳንዳቸው 2 ድምፅ ያላቸው 3 ተወካዮች ያሉት ምክር ቤት ሁለቱም 6 ድምፅ ይይዛሉ። ምክር ቤቱን ሲፈጥሩ በመቀመጫዎች/ድምፆች መስኮች ወይም በማስመጫ ሰንጠረዡ የመጨረሻ አምድ ያስቀምጡት፤ በኋላ በምክር ቤቱ ገጽ ላይ በ«አስተካክል» ይቀይሩት (ከሚቀጥለው ድምፃቸው ጀምሮ ለሁሉም ተወካዮቹ ይተገበራል)።",
          "እንዴት ይቆጠራል። ክብደቱ ድምፅ ሲሰጥ በእያንዳንዱ ድምፅ ላይ ይታተማል፣ ስለዚህ ሚስጥራዊ ድምፆች ስም-አልባ ሆነው ይቀጥላሉ። ውጤቶች፣ የተለጠፉ ቆጠራዎች እና ሪፖርቱ የተሰጡ ድምፆችን (ሰዎች) እና ሲለያዩ የተቆጠሩ ድምፆችን (በክብደት) ያሳያሉ። አብላጫ ድምፅ በድምፆች ይሰላል፤ ምልዓተ ጉባኤ የተሰጡ ድምፆች ብዛት (ድምፅ የሰጡ ተወካዮች) ነው።",
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
            "ምልዓተ ጉባኤ (ድምፁ ትክክለኛ እንዲሆን ድምፅ መስጠት ያለባቸው ብቁ አባላት መቶኛ፤ ድምፅ መስጫው ሲዘጋ ከንቁ አባላት ብዛት ወደ የድምፆች ብዛት ይቀየራል) እና ለማጽደቅ የሚያስፈልገውን አብላጫ ድምፅ ያስቀምጡ፦ ቀላል አብላጫ ወይም 2/3።",
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
            "ከውሳኔ ሀሳቡ ርዕስ ጋር ባለ 4 አሃዝ የማግበሪያ ኮድ ይታያል። «ርዕሱን እና ኮዱን ቅዳ»ን ነክተው በቪዲዮ ጥሪው ውይይት (Zoom፣ Google Meet፣ የቴሌግራም ጥሪ) ውስጥ ይለጥፉት፣ ወይም በአዳራሹ ስክሪን ላይ ያሳዩት — በጉባኤው ቡድን ውስጥ ፈጽሞ አይደለም። አባላት ድምፅ ከመስጠታቸው በፊት ማስገባት አለባቸው፣ ይህም በስብሰባው ውስጥ መሆናቸውን ያረጋግጣል። ኮዱ በውሳኔ ሀሳቡ ገጽ ላይ ይቆያል፤ ከወጣ «አዲስ ኮድ» ይተካዋል። ለማያስፈልጋቸው ድምፆች በረቂቁ ላይ «የማግበሪያ ኮድ ይጠየቅ»ን ያጥፉ።",
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
            "ምልዓተ ጉባኤ ከመሟላቱ በፊት (ድምፀ ተአቅቦ ይቆጠራል) የመዝጊያ ሰዓቱ ካለፈ ድምፅ መስጠት ክፍት ይቆያል፦ የውሳኔ ሀሳቡ «የመዝጊያ ሰዓቱ ያለ ምልዓተ ጉባኤ አልፏል» ያሳያል፣ ለእያንዳንዱ አስተዳዳሪ መልዕክት ይደርሳል፣ ያልመረጡ ተወካዮችም አንድ ማሳሰቢያ ይደርሳቸዋል። «ድምፅ መስጠትን አራዝም…» (የፈለጉትን ያህል ደቂቃ)፣ «ልክ እንዳልሆነ ዝጋ»፣ ወይም «ዝጋ እና እንደገና አዘጋጅ» (ዘግቶ ያንኑ የውሳኔ ሀሳብ እንደ አዲስ ረቂቅ ያዘጋጃል) ይምረጡ። በዚህ መሀል ምልዓተ ጉባኤ ከተሟላ በራሱ ይዘጋል።",
            "የመጨረሻ ውጤቶች የውሳኔ ሀሳቡ በታወቀበት ርዕስ ውስጥ በራስ-ሰር ይለጠፋሉ።",
            "በሌላ ርዕስ ውስጥም ለማተም «የመጨረሻ ውጤቶችን ወደ ርዕስ ለጥፍ»ን ይጠቀሙ።",
            "ቀድሞ ወይም በስህተት ተዘግቷል? በተዘጋው የውሳኔ ሀሳብ ላይ «ድምፅ መስጠትን እንደገና ክፈት»ን ይንኩና አዲስ የመዝጊያ ሰዓት (ወይም ምንም) ይምረጡ። ቀደም ሲል የተሰጡ ድምፆች ይቆያሉ፣ ያልመረጡ አባላት መምረጥ ይችላሉ፣ ሲዘጋም የመጨረሻ ውጤቶች እንደገና ይታተማሉ።",
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
            "በመተግበሪያው ውስጥ ርዕስ መሰየም በቡድኑ ውስጥ አልቀየረውም፦ ቦቱ የ«ርዕሶችን አስተዳድር» መብት የለውም። በቡድኑ የአስተዳዳሪ ቅንብሮች ውስጥ ይስጡትና ስሙን እንደገና ያስቀምጡ።",
            "ቦቱ የተወገደበት ቡድን አሁንም በ«ማዋቀር» ውስጥ ይታያል፦ ↻ን ይንኩ። መተግበሪያው የቦቱን አባልነት አረጋግጦ ቡድኑን ያላቅቃል፤ «ቡድኑን አላቅቅ» በእጅ ተመሳሳይ ነገር ያደርጋል።",
            "በርዕስ ውስጥ መልዕክት ከላኩ በኋላ ርዕሱ አይታይም፦ በ«ማዋቀር» አናት ላይ ያለውን «ጤንነት» ይክፈቱና «ከቴሌግራም የመጨረሻ ዝመና»ን ያንብቡ። መልዕክት ከላኩ በኋላ ያ መስመር ካልተቀየረ፣ ቴሌግራም ዝመናዎችን ወደዚህ አገልጋይ እያደረሰ አይደለም — ከ«ማዋቀር» ዌብሁኩን እንደገና ይመዝግቡ።",
            "የሙከራ ቡድኑ ተሰርዞ አዲስ ተፈጥሯል፦ ቦቱ ከተገናኘው ቡድን ሲወገድ ቡድኑን ይረሳል እና ለአስተዳዳሪዎች በግል መልዕክት የጉባኤውን መረጃ (ምክር ቤቶች፣ አባላት፣ ግብዣዎች፣ የውሳኔ ሀሳቦች እና ድምፆች) በሁለተኛ የማረጋገጫ ንክኪ እንዲያጠፉ ያቀርባል፣ ስለዚህ አዲሱ ቡድን ንጹህ ይጀምራል እና ምንም የምክር ቤት ወይም የአባል ስም ከተረፈ ነገር ጋር አይጋጭም። «ማዋቀር» › «የጉባኤውን መረጃ ዳግም አስጀምር» ተመሳሳይ ነገር ያደርጋል፣ እዚያ ያለው ማብሪያ ደግሞ ማጥፋቱን በመወገድ ላይ በራስ-ሰር ያደርገዋል — ቦቱ በስህተት መወገዱ ተቀባይነት ካለው ብቻ ያብሩት።",
            "አባላት የት ይገባሉ? በቡድኑ ውስጥ ቦቱ የተሰካ ካርድ ያለው «📝 ይመዝገቡ / ይግቡ» ርዕስ ይይዛል (ቦቱ አስተዳዳሪ ሲሆን የተፈጠረ፤ በ«ማዋቀር» ያለው «የመግቢያ ርዕስ ለጥፍ» እንደገና ይለጥፈዋል)። «በኮድዎ ይመዝገቡ» የሚለው አዝራር አባሉን ከቦቱ ጋር ወደ የግል ውይይት ይወስዳል፣ እዚያም የግብዣ ኮዳቸውን እና የይለፍ ቃላቸውን ከሁሉም ዓይን ውጭ ያስገባሉ። በቡድኑ ውስጥ ራሱ ምንም አይተየብም።",
            "አንድ ሰው ሳይመዘገብ በቡድኑ ውስጥ አለ፦ «ማዋቀር» › «በቡድኑ ውስጥ ያሉ ሰዎች» ቦቱ ያያቸውን፣ የተመዘገቡ አባላት ወይም አስተዳዳሪዎች ያልሆኑትን ሁሉ ይዘረዝራል። ሰውዬውን ነክተው ይመዝግቧቸው (ስም፣ ምክር ቤት፣ ሚና — የቴሌግራም መለያቸው ወዲያውኑ ይገናኛል፣ ኮድ አያስፈልግም)፣ የመቀላቀል ጥያቄያቸውን ይፍቀዱ ወይም አይቀበሉ፣ ወይም ያስወግዷቸው። ሳይመዘገብ የሚቀላቀልን ማንኛውንም ሰው ቦቱ እንዲያስወግድ «ያልተመዘገቡ ሰዎችን በራስ-ሰር አስወግድ»ን ያብሩ። ቴሌግራም ለቦቶች የአባላት ዝርዝር አይሰጥም፣ ስለዚህ አስቀድመው ውስጥ ያሉ ሰዎች መልዕክት ሲልኩ ወይም እንደገና ሲቀላቀሉ ብቻ ይታያሉ።",
            "ተራ አባላት ሰዎችን መጨመር፣ ቡድኑን እንደገና መሰየም፣ መልዕክት መሰካት ወይም ርዕስ መፍጠር ይችላሉ፦ ቴሌግራም ለአዲስ ቡድኖች እነዚህን ሁሉ ያበራል። ቦቱ የ«ተጠቃሚዎችን አግድ» መብት ያለው አስተዳዳሪ እንደተደረገ ወዲያውኑ ያጠፋቸዋል፤ «ማዋቀር» «የአባላት ፈቃዶች፦ ተቆልፏል» ያሳያል። አባላት አሁንም አንድ ነገር ይችላሉ ካለ፣ ለቦቱ ያንን መብት ይስጡና «ቡድኑን ለአባላት ቆልፍ»ን ይንኩ፣ ወይም በቡድኑ ውስጥ ፈቃዶችን በእጅ ይቀይሩ።",
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
            "Your council may give each delegate more than one vote. The Vote and Me tabs then say how many votes your ballot counts as; you still cast one ballot per resolution.",
            "Keep the invitation private: anyone holding it could vote in your place.",
          ] },
        ],
      },
      {
        icon: "🗳", title: "Cast your vote",
        body: [
          { steps: [
            "Open the Vote tab. Every resolution that is open for voting is listed with its options.",
            "If the resolution asks for an activation code, type the 4 digits shown in the meeting (on the screen or in the video-call chat) and tap “Activate”. You do this once per resolution.",
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
            "ምክር ቤትዎ ለእያንዳንዱ ተወካይ ከአንድ በላይ ድምፅ ሊሰጥ ይችላል። ከዚያ «ድምፅ ይስጡ» እና «እኔ» ትሮች ድምፅዎ እንደ ስንት ድምፅ እንደሚቆጠር ይናገራሉ፤ አሁንም በእያንዳንዱ የውሳኔ ሀሳብ አንድ ድምፅ ይሰጣሉ።",
            "ጥሪውን በግል ያስቀምጡ፦ የያዘው ማንኛውም ሰው በእርስዎ ምትክ ድምፅ መስጠት ይችላል።",
          ] },
        ],
      },
      {
        icon: "🗳", title: "ድምፅዎን መስጠት",
        body: [
          { steps: [
            "«ድምፅ ይስጡ» ትርን ይክፈቱ። ለድምፅ ክፍት የሆነ እያንዳንዱ የውሳኔ ሀሳብ ከአማራጮቹ ጋር ተዘርዝሯል።",
            "የውሳኔ ሀሳቡ የማግበሪያ ኮድ ከጠየቀ፣ በስብሰባው ውስጥ የታዩትን 4 አሃዞች (በስክሪኑ ላይ ወይም በቪዲዮ ጥሪው ውይይት) ይጻፉና «አግብር»ን ይንኩ። ይህን በአንድ የውሳኔ ሀሳብ አንድ ጊዜ ያደርጋሉ።",
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
