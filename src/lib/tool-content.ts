import { shortName, type Tool } from "@/lib/tools";

export type ToolContent = {
  description: string;
  useCases: string[];
  features: string[];
  pros: string[];
  limits: string[];
  audience: string;
  prompt: string;
  steps: string[];
  tips: string[];
  /** True when the copy was written specifically for this tool rather than from the category template. */
  curated: boolean;
};

type CategoryTemplate = {
  purpose: string;
  useCases: string[];
  features: string[];
  audience: string;
  prompt: string;
  steps: string[];
  tips: string[];
};

const T: Record<string, CategoryTemplate> = {
  "ai-writing-tools": {
    purpose: "draft, rewrite and polish written content faster",
    useCases: ["Drafting articles, emails and reports", "Rewriting text in a different tone or length", "Brainstorming outlines and headlines", "Proofreading and tightening copy"],
    features: ["Text generation from a short brief", "Tone and style controls", "Rewrite, expand and summarize actions", "Grammar and clarity suggestions"],
    audience: "Writers, marketers, students and anyone who writes regularly.",
    prompt: "Act as an experienced editor. Using {name}, help me write a [type of content, e.g. blog post] about [topic] for [target audience].\nTone: [e.g. friendly and professional]\nLength: [e.g. 600 words]\nMust include: [key points]\nFinish with: [call to action]\nThen list 3 ways I could improve the draft.",
    steps: ["Open {name} and start a new document or chat.", "Paste the prompt below and replace each [placeholder] with your details.", "Review the first draft and ask for changes (shorter, more formal, add examples).", "Fact-check names, numbers and claims before publishing.", "Save your best prompt so you can reuse it."],
    tips: ["Give it a sample of your own writing so the style matches yours.", "Ask for several versions and combine the best parts.", "Always edit the final text yourself."],
  },
  "ai-image-tools": {
    purpose: "create, edit and enhance images from text or existing pictures",
    useCases: ["Generating illustrations and concept art", "Editing or retouching photos", "Creating social media and marketing visuals", "Upscaling and restoring images"],
    features: ["Text-to-image generation", "Style and aspect-ratio options", "Editing, fill and variation tools", "Export in common image formats"],
    audience: "Designers, marketers, creators and anyone who needs visuals quickly.",
    prompt: "Create an image of [subject] in [art style, e.g. flat illustration / photorealistic].\nSetting: [location or background]\nLighting and mood: [e.g. warm golden hour, calm]\nColour palette: [colours]\nComposition: [e.g. close-up, centered, 16:9]\nAvoid: [things to leave out, e.g. text, extra fingers].",
    steps: ["Open {name} and choose to create or edit an image.", "Paste the prompt below and fill in the placeholders.", "Generate a few variations and pick the closest one.", "Refine by changing one detail at a time (style, lighting, framing).", "Download the result and check the tool's licence terms before commercial use."],
    tips: ["Be specific about style, lighting and composition.", "Change one thing per iteration so you learn what works.", "Check usage rights for commercial projects."],
  },
  "ai-video-tools": {
    purpose: "generate, edit and repurpose video with less manual work",
    useCases: ["Turning scripts into short videos", "Editing and trimming footage", "Creating talking-head or avatar videos", "Adding captions, translation or voiceover"],
    features: ["Text- or image-to-video generation", "Automatic captions and editing", "Templates and brand styling", "Export for social and web"],
    audience: "Marketers, educators, creators and teams producing video on a budget.",
    prompt: "Create a [length, e.g. 30-second] video for [platform, e.g. Instagram Reels] about [topic].\nAudience: [who it is for]\nStyle: [e.g. clean, upbeat, cinematic]\nScenes: 1) [opening hook] 2) [main point] 3) [call to action]\nVoiceover tone: [e.g. confident, friendly]\nOn-screen text: [key phrases].",
    steps: ["Open {name} and start a new project.", "Paste the prompt below, or your script, and fill in the placeholders.", "Generate a first cut and review pacing and visuals.", "Adjust scenes, captions and audio.", "Export in the right format and ratio for your platform."],
    tips: ["Lead with a strong first three seconds.", "Keep scripts short; ask for one idea per scene.", "Preview with sound on and off."],
  },
  "ai-audio-voice-tools": {
    purpose: "generate, clean up and transcribe voice and audio",
    useCases: ["Creating voiceovers and narration", "Cleaning up recordings", "Transcribing meetings and podcasts", "Producing music or sound effects"],
    features: ["Natural-sounding voice generation", "Noise reduction and enhancement", "Transcription and captions", "Multiple voices and languages"],
    audience: "Podcasters, video creators, educators and teams that work with audio.",
    prompt: "Generate a voiceover for the script below.\nVoice style: [e.g. warm, calm, female / male]\nPace: [e.g. medium, with short pauses]\nLanguage and accent: [language / accent]\nUse case: [e.g. product explainer]\nScript: [paste your script here].",
    steps: ["Open {name} and create a new audio project.", "Paste your script or upload your recording.", "Choose a voice and adjust pace and emphasis.", "Preview, fix mispronunciations, then export.", "Confirm you have the right to use any voice you clone."],
    tips: ["Add punctuation to control pauses.", "Spell out tricky names phonetically.", "Only clone voices you have permission to use."],
  },
  "ai-chatbots-assistants": {
    purpose: "answer questions, brainstorm and complete tasks through conversation",
    useCases: ["Research and quick answers", "Brainstorming and planning", "Summarizing long documents", "Drafting and editing text or code"],
    features: ["Conversational interface", "Follows detailed instructions", "Summaries and explanations", "Often supports file uploads or web access"],
    audience: "Almost anyone: students, professionals, developers and teams.",
    prompt: "You are an expert [role, e.g. product manager]. Help me with [task or question].\nContext: [background that matters]\nMy goal: [what a good result looks like]\nConstraints: [time, budget, format]\nAnswer in: [e.g. a short checklist / a table].\nAsk me up to 3 clarifying questions first if anything is unclear.",
    steps: ["Open {name} and start a new conversation.", "Paste the prompt below and fill in the placeholders.", "Answer any clarifying questions it asks.", "Ask follow-ups to refine, shorten or expand the answer.", "Verify important facts with a reliable source."],
    tips: ["Give context and a clear goal.", "Ask it to explain its reasoning when stakes are high.", "Don't paste confidential data unless you've checked the privacy terms."],
  },
  "ai-marketing-tools": {
    purpose: "plan, create and optimize marketing campaigns",
    useCases: ["Writing ad copy and landing pages", "Planning content calendars", "Segmenting audiences", "Analyzing campaign results"],
    features: ["Campaign and copy generation", "Audience and persona suggestions", "Performance insights", "Integrations with marketing platforms"],
    audience: "Marketers, founders and agencies.",
    prompt: "Create a [channel, e.g. email / LinkedIn ad] campaign for [product].\nAudience: [persona and pain points]\nGoal: [e.g. 100 free trial sign-ups]\nOffer: [discount or benefit]\nTone: [brand voice]\nGive me 3 headline options, body copy, and a clear call to action, plus 2 A/B test ideas.",
    steps: ["Open {name} and create a new campaign or project.", "Paste the prompt below and fill in the placeholders.", "Generate options and shortlist the best.", "Edit for brand voice and legal accuracy.", "Launch a small test and review the results."],
    tips: ["Start from a specific audience, not 'everyone'.", "Test one variable at a time.", "Check claims against your actual offer."],
  },
  "ai-seo-tools": {
    purpose: "research keywords and optimize content for search",
    useCases: ["Keyword and topic research", "Content briefs and outlines", "On-page optimization", "Tracking rankings and competitors"],
    features: ["Keyword suggestions", "Content scoring and briefs", "SERP and competitor analysis", "Site audit checks"],
    audience: "SEO specialists, bloggers, agencies and site owners.",
    prompt: "Act as an SEO strategist. For the topic [topic] and website [domain], give me:\n1) 10 keyword ideas with search intent\n2) A content outline for the best one (H2/H3)\n3) 5 internal-link ideas\n4) A meta title (under 60 characters) and meta description (under 155 characters).\nAudience: [who searches this].",
    steps: ["Open {name} and enter your topic or domain.", "Review keyword and competitor suggestions.", "Paste the prompt below to create a brief and outline.", "Write or edit the page, then run the on-page check.", "Track rankings over the next weeks and update the page."],
    tips: ["Match the page to search intent, not just the keyword.", "Don't publish unedited AI text.", "Re-check data in a second source."],
  },
  "ai-coding-developer-tools": {
    purpose: "write, review and debug code faster",
    useCases: ["Autocompleting and generating code", "Explaining unfamiliar code", "Finding and fixing bugs", "Writing tests and documentation"],
    features: ["Code completion and chat", "Refactoring suggestions", "Test and docs generation", "Editor or IDE integration"],
    audience: "Developers, students and technical teams.",
    prompt: "You are a senior [language] engineer. Here is my code:\n[paste code]\nProblem: [what is wrong or what you want]\nEnvironment: [language/framework versions]\nPlease explain the cause, give a corrected version, and add one unit test. Keep changes minimal and explain any trade-offs.",
    steps: ["Install or open {name} in your editor or browser.", "Paste the prompt below with your code and details.", "Review the suggested change line by line.", "Run your tests and linters before accepting it.", "Commit in small steps so you can roll back."],
    tips: ["Never accept code you don't understand.", "Share error messages and versions.", "Don't paste secrets or private keys."],
  },
  "ai-design-ui-ux-tools": {
    purpose: "speed up UI design, prototyping and design systems",
    useCases: ["Generating layouts and wireframes", "Creating UI components", "Prototyping flows", "Maintaining brand consistency"],
    features: ["Layout and component generation", "Design-to-code handoff", "Templates and design systems", "Collaboration features"],
    audience: "Designers, product teams and founders.",
    prompt: "Design a [screen, e.g. mobile onboarding] for [product].\nUsers: [who they are]\nGoal: [what the screen must achieve]\nStyle: [e.g. minimal, rounded, brand colours #hex]\nInclude: [elements]\nSuggest the layout, components, and 2 accessibility considerations.",
    steps: ["Open {name} and create a new design file.", "Paste the prompt below and fill in the placeholders.", "Generate options and pick a direction.", "Refine spacing, typography and colours.", "Test with real users before shipping."],
    tips: ["Start with the user's goal.", "Check contrast and tap-target sizes.", "Keep a consistent component set."],
  },
  "ai-social-media-tools": {
    purpose: "plan, create and schedule social media content",
    useCases: ["Writing captions and posts", "Planning content calendars", "Repurposing content across platforms", "Analyzing engagement"],
    features: ["Post and caption generation", "Scheduling", "Hashtag and idea suggestions", "Analytics"],
    audience: "Creators, social media managers and small businesses.",
    prompt: "Create a week of [platform] posts for [brand / account].\nAudience: [who follows you]\nGoals: [e.g. engagement, sign-ups]\nTone: [voice]\nFor each day give: a hook, caption, 3 hashtags, and a visual idea. Mix educational, behind-the-scenes and promotional posts.",
    steps: ["Open {name} and connect or create your account profile.", "Paste the prompt below and fill in the placeholders.", "Edit captions so they sound like you.", "Schedule posts at times your audience is active.", "Review engagement and reuse what worked."],
    tips: ["Lead with a strong first line.", "Reply to comments quickly.", "Follow each platform's rules on automation."],
  },
  "ai-business-tools": {
    purpose: "automate business tasks and support decisions",
    useCases: ["Automating repetitive workflows", "Summarizing reports and data", "Drafting proposals and documents", "Customer support and sales assistance"],
    features: ["Workflow automation", "Document and data summaries", "Integrations with business apps", "Team collaboration"],
    audience: "Founders, operations teams and managers.",
    prompt: "Act as a business analyst. Help me with [task, e.g. summarize this report / design this workflow].\nContext: [company, team, tools in use]\nInput: [paste data or description]\nOutput: [e.g. a one-page summary / step-by-step process]\nHighlight risks, assumptions and next actions.",
    steps: ["Open {name} and create a new workflow or project.", "Paste the prompt below with your information.", "Review the output for accuracy.", "Connect it to the tools your team uses.", "Measure time saved and adjust."],
    tips: ["Automate one process first.", "Keep a human check on important decisions.", "Review data-privacy terms before uploading company data."],
  },
  "ai-office-tools": {
    purpose: "make everyday office work such as documents, slides, meetings and email faster",
    useCases: ["Summarizing meetings and documents", "Drafting presentations", "Managing email and schedules", "Organizing notes and tasks"],
    features: ["Meeting notes and summaries", "Slide and document drafting", "Email and calendar assistance", "App integrations"],
    audience: "Professionals, teams and students.",
    prompt: "Help me prepare [deliverable, e.g. a 10-slide deck / meeting summary].\nTopic: [topic]\nAudience: [who will read it]\nKey points: [list]\nFormat: [e.g. bullet points, action items with owners and dates]\nKeep it concise and professional.",
    steps: ["Open {name} and create a new document, deck or meeting.", "Paste the prompt below and fill in the placeholders.", "Review the draft and fix details.", "Share with your team for feedback.", "Save it as a template for next time."],
    tips: ["Provide the raw notes, not just a title.", "Check names, dates and numbers.", "Use templates for recurring tasks."],
  },
  "ai-resume-hr-tools": {
    purpose: "support resumes, job applications and hiring",
    useCases: ["Writing and tailoring resumes", "Drafting cover letters", "Screening and scheduling candidates", "Writing job descriptions"],
    features: ["Resume and letter templates", "Job-description matching", "Keyword suggestions", "Applicant workflow tools"],
    audience: "Job seekers, recruiters and HR teams.",
    prompt: "Tailor my resume for the role of [job title] at [company].\nMy experience: [paste resume or bullet points]\nJob description: [paste job description]\nRewrite my top 6 bullet points with measurable results, add the most relevant keywords naturally, and suggest a 3-line summary. Don't invent experience.",
    steps: ["Open {name} and upload or paste your resume or job details.", "Paste the prompt below and fill in the placeholders.", "Review every line and remove anything that isn't true.", "Export in the format the employer requests.", "Tailor again for each application."],
    tips: ["Quantify results where you can.", "Never claim skills you don't have.", "Hiring teams should avoid relying on automated screening alone."],
  },
  "ai-education-learning-tools": {
    purpose: "help people learn, teach and study more effectively",
    useCases: ["Explaining difficult topics", "Creating study guides and quizzes", "Tutoring and practice", "Planning lessons"],
    features: ["Step-by-step explanations", "Quiz and flashcard generation", "Personalized practice", "Lesson planning help"],
    audience: "Students, teachers and lifelong learners.",
    prompt: "Teach me [topic] as if I'm a [level, e.g. beginner].\nMy goal: [what I need to do with it]\nExplain it in simple steps with 2 real-world examples, then give me 5 practice questions with answers hidden until I ask. Check my understanding before moving on.",
    steps: ["Open {name} and start a learning session.", "Paste the prompt below and fill in the placeholders.", "Work through the examples and answer the questions.", "Ask for simpler or deeper explanations as needed.", "Confirm key facts in your course materials."],
    tips: ["Try problems yourself before reading answers.", "Ask it to quiz you.", "Follow your school's rules on AI use."],
  },
  "ai-e-commerce-tools": {
    purpose: "grow and run an online store",
    useCases: ["Writing product descriptions", "Creating product images and ads", "Customer support automation", "Pricing and inventory insights"],
    features: ["Product copy and image generation", "Chat and support assistants", "Store platform integrations", "Sales analytics"],
    audience: "Online sellers, store owners and e-commerce marketers.",
    prompt: "Write a product listing for [product].\nKey features: [list]\nTarget customer: [who and why they buy]\nTone: [brand voice]\nGive me: a title (under 80 characters), 5 bullet points focused on benefits, a 120-word description, and 10 search keywords. Don't make claims I haven't provided.",
    steps: ["Open {name} and connect or create your store project.", "Paste the prompt below and fill in the placeholders.", "Review copy for accuracy and policy compliance.", "Publish and track conversion.", "Test variations of titles and images."],
    tips: ["Lead with the customer's benefit.", "Keep claims truthful.", "Test one change at a time."],
  },
};

const FALLBACK: CategoryTemplate = T["ai-chatbots-assistants"]!;

const catSlug = (category: string) =>
  category.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Hand-written copy for popular tools. Keyed by lower-case name without a trailing "(Company)".
const CURATED: Record<string, Partial<ToolContent> & { description: string }> = {
  chatgpt: {
    description: "ChatGPT is OpenAI's conversational AI assistant. You describe what you need in plain language and it can write, explain, summarize, brainstorm and help with code, then refine its answer as you reply.",
    features: ["Natural conversation with follow-up questions", "Writing, summarizing and rewriting", "Coding help and debugging", "Often supports file uploads and image input (varies by plan)"],
    pros: ["Very flexible for many kinds of tasks", "Easy to start with plain-language prompts", "Can iterate on its answers in the same chat"],
    limits: ["Can state incorrect information confidently", "Features and limits depend on your plan", "Avoid sharing sensitive data without checking the privacy settings"],
  },
  claude: {
    description: "Claude is Anthropic's AI assistant. It's used for writing, analysis, coding and working through long documents, and is designed to follow detailed instructions in a helpful, careful way.",
    features: ["Long-document reading and summaries", "Writing and editing with tone control", "Coding and analysis help", "Can work with uploaded files (varies by plan)"],
    pros: ["Handles long, detailed instructions well", "Strong at writing and analysis", "Clear, structured answers"],
    limits: ["Can still make mistakes, so verify key facts", "Usage limits depend on your plan"],
  },
  gemini: {
    description: "Gemini is Google's AI assistant. It answers questions, helps with writing and planning, and works with other Google services, so it can fit naturally into existing Google workflows.",
    features: ["Conversational answers and brainstorming", "Writing and summarizing", "Works with Google apps (varies by plan)", "Image and file input in supported versions"],
    pros: ["Convenient if you already use Google products", "Handles many everyday tasks"],
    limits: ["Features differ by region and account type", "Verify important facts independently"],
  },
  midjourney: {
    description: "Midjourney generates images from text descriptions, known for highly stylized, artistic results. You write a prompt, review a set of options, then vary or upscale the ones you like.",
    features: ["Text-to-image generation", "Style and aspect-ratio parameters", "Variations and upscaling", "Community gallery for inspiration"],
    pros: ["Distinctive, high-quality artistic looks", "Fast iteration on a prompt"],
    limits: ["Prompt wording takes practice", "Check the licence terms for commercial use"],
  },
  "perplexity ai": {
    description: "Perplexity is an AI-powered answer engine. You ask a question and it replies with a summary that includes cited sources, so you can check where the information came from.",
    features: ["Answers with source citations", "Follow-up questions in context", "Focus modes for different kinds of search"],
    pros: ["Sources make answers easier to verify", "Fast for research and fact-finding"],
    limits: ["Still check the cited pages yourself", "Some features need a paid plan"],
  },
  "cursor ai": {
    description: "Cursor is an AI-first code editor. It lets you chat with your codebase, generate and edit code across files, and fix errors without leaving the editor.",
    features: ["AI chat with your project context", "Multi-line code completion", "Edit code with natural-language instructions"],
    pros: ["AI built into the editing workflow", "Understands project context"],
    limits: ["Review every change before accepting", "Some features require a paid plan"],
  },
  elevenlabs: {
    description: "ElevenLabs generates realistic speech from text, with many voices and languages. Creators use it for narration, voiceovers, audiobooks and dubbing.",
    features: ["Text-to-speech with natural voices", "Multiple languages", "Voice customization options", "Sound effects and dubbing tools"],
    pros: ["Natural-sounding output", "Quick voiceovers without recording"],
    limits: ["Only clone voices you have permission to use", "Usage is limited by plan"],
  },
  "notion ai": {
    description: "Notion AI adds writing, summarizing and organizing help inside Notion pages and databases, so you can draft, clean up and search your notes without switching apps.",
    features: ["Summarize and rewrite page content", "Draft text inside your workspace", "Help organize notes and tasks"],
    pros: ["Works where your notes already live", "Handy for meeting notes and docs"],
    limits: ["Requires Notion", "AI features may need a paid add-on"],
  },
  canva: {
    description: "Canva is an online design platform with templates and AI tools for social posts, presentations, documents, video and more, aimed at people without design training.",
    features: ["Large template library", "AI image and design helpers", "Brand kits and team sharing", "Presentations, video and print designs"],
    pros: ["Very beginner-friendly", "Fast to produce polished designs"],
    limits: ["Advanced features need a paid plan", "Templates are widely used, so customize them"],
  },
  grammarly: {
    description: "Grammarly checks your writing for grammar, spelling, clarity and tone, and offers AI writing help in the apps and websites where you type.",
    features: ["Grammar and spelling checks", "Clarity and tone suggestions", "Works in browsers and many apps", "AI rewriting help"],
    pros: ["Catches mistakes as you type", "Works across many apps"],
    limits: ["Suggestions need your judgement", "Premium features require a paid plan"],
  },
  "jasper ai": {
    description: "Jasper is an AI content platform for marketing teams. It helps produce on-brand copy for campaigns, blogs and ads using brand voice settings and templates.",
    features: ["Brand voice and style settings", "Marketing copy templates", "Team collaboration features"],
    pros: ["Built around marketing workflows", "Helps keep copy consistent across a team"],
    limits: ["Review copy for accuracy", "Typically aimed at paid team use"],
  },
  "runway ml": {
    description: "Runway is an AI creative suite for video. It can generate clips from text or images and offers editing tools for creators and filmmakers.",
    features: ["Text- and image-to-video generation", "AI video editing tools", "Creative effects"],
    pros: ["Powerful for experimental and short-form video", "Active development of new models"],
    limits: ["Generation uses credits", "Results vary; expect to iterate"],
  },
  synthesia: {
    description: "Synthesia creates videos with AI avatars that speak your script, so teams can produce training and explainer videos without cameras or actors.",
    features: ["AI presenter avatars", "Text-to-video from a script", "Many languages"],
    pros: ["No filming needed", "Easy to update videos by editing the script"],
    limits: ["Avatars may feel less personal than real presenters", "Plans are limited by minutes"],
  },
  heygen: {
    description: "HeyGen produces avatar videos from text and supports video translation, helping teams create marketing, training and sales videos quickly.",
    features: ["AI avatars and talking-head videos", "Video translation", "Template-based creation"],
    pros: ["Quick avatar video creation", "Useful for localization"],
    limits: ["Credits or minutes are limited by plan", "Disclose AI-generated presenters where appropriate"],
  },
  "suno ai": {
    description: "Suno generates songs with vocals and instrumentation from a text description or lyrics, letting anyone sketch a track in a chosen genre.",
    features: ["Text-to-song generation", "Genre and style prompts", "Custom lyrics"],
    pros: ["Very fast way to prototype music", "No instruments needed"],
    limits: ["Check licensing terms before commercial use", "Results vary between generations"],
  },
  "leonardo ai": {
    description: "Leonardo AI is an image-generation platform with model choices and editing tools, popular for game assets, concept art and marketing visuals.",
    features: ["Text-to-image generation", "Multiple models and styles", "Image editing and upscaling"],
    pros: ["Good control over style", "Useful for consistent asset sets"],
    limits: ["Free usage is limited", "Review the licence for commercial use"],
  },
  descript: {
    description: "Descript edits audio and video by editing the transcript. You delete words from the text and the media changes with it, with AI tools for cleanup and voiceover.",
    features: ["Transcript-based editing", "Filler-word removal", "AI voice and cleanup tools", "Screen recording"],
    pros: ["Editing feels like editing a document", "Great for podcasts and tutorials"],
    limits: ["Learning the workflow takes a little time", "Some features need a paid plan"],
  },
  "murf ai": {
    description: "Murf is an AI voice generator for studio-style voiceovers. You paste a script, choose a voice, and download narration for videos, presentations and training.",
    features: ["Text-to-speech voices", "Pitch, speed and emphasis controls", "Voiceover syncing with video"],
    pros: ["Polished voiceovers quickly", "Simple interface"],
    limits: ["Usage limits depend on plan", "Some voices cost more to use"],
  },
  gamma: {
    description: "Gamma generates presentations, documents and simple web pages from a prompt or outline, then lets you edit the design in a clean, card-based editor.",
    features: ["Prompt-to-presentation generation", "Editable layouts and themes", "Shareable links"],
    pros: ["Fast first drafts of slide decks", "Modern look with little effort"],
    limits: ["Review the content for accuracy", "Export and branding options vary by plan"],
  },
  zapier: {
    description: "Zapier connects thousands of web apps so you can automate workflows without code, now with AI features for building and running those automations.",
    features: ["No-code automations between apps", "Triggers and actions across many services", "AI-assisted workflow building"],
    pros: ["Saves time on repetitive tasks", "Huge number of app integrations"],
    limits: ["Costs scale with usage", "Complex workflows need testing"],
  },
  "otter.ai": {
    description: "Otter records and transcribes meetings in real time, generating summaries and action items so you can focus on the conversation.",
    features: ["Live meeting transcription", "Automatic summaries and action items", "Searchable transcripts"],
    pros: ["Saves manual note-taking", "Easy to search past meetings"],
    limits: ["Accuracy varies with audio quality", "Tell participants when recording"],
  },
  "copy.ai": {
    description: "Copy.ai uses AI to write marketing and sales copy and automate go-to-market workflows, from emails and product descriptions to social posts.",
    features: ["Marketing and sales copy generation", "Templates and brand voice", "Workflow automation"],
    pros: ["Quick first drafts", "Good for repeatable copy tasks"],
    limits: ["Edit for accuracy and voice", "Some features need a paid plan"],
  },
  "pika labs": {
    description: "Pika generates short videos from text or images, with tools for effects and quick edits, aimed at creators making social content.",
    features: ["Text- and image-to-video", "Creative effects", "Short-form clips"],
    pros: ["Quick, playful video generation", "Easy to try"],
    limits: ["Short clip lengths", "Results vary; expect to iterate"],
  },
  quillbot: {
    description: "QuillBot paraphrases and rewrites text, and also offers a grammar checker and summarizer, which helps students and writers rephrase and tighten their writing.",
    features: ["Paraphrasing in multiple modes", "Grammar checker", "Summarizer"],
    pros: ["Helps rephrase awkward sentences", "Simple and quick"],
    limits: ["Use responsibly and follow your institution's academic rules", "Premium modes need a paid plan"],
  },
  writesonic: {
    description: "Writesonic is an AI writing platform for articles, ads and landing pages, with tools to support SEO-focused content creation.",
    features: ["Article and ad copy generation", "SEO-focused writing tools", "Templates for common formats"],
    pros: ["Many ready-made templates", "Fast long-form drafts"],
    limits: ["Review and fact-check output", "Higher usage needs a paid plan"],
  },
  figma: {
    description: "Figma is a collaborative design tool for interfaces and prototypes, with AI features that help generate layouts and speed up repetitive design work.",
    features: ["Collaborative design in the browser", "Prototyping", "Reusable components and design systems", "AI-assisted design features"],
    pros: ["Real-time collaboration", "Widely used across teams"],
    limits: ["Some AI features are plan-dependent", "Takes time to learn advanced features"],
  },
  poe: {
    description: "Poe lets you chat with many different AI models and custom bots in one place, so you can compare answers or use specialized bots.",
    features: ["Access to multiple AI models", "Custom bots", "Compare responses"],
    pros: ["One place to try several models", "Easy to switch between them"],
    limits: ["Model access and limits depend on plan"],
  },
};

const stripAi = (s: string) => s.replace(/^AI /, "").replace(/ Tools$/, "");
const fill = (s: string, tool: Tool) => s.replace(/\{name\}/g, tool.name.replace(/ \(.+\)$/, ""));

export function contentFor(tool: Tool): ToolContent {
  const tpl = T[catSlug(tool.category)] ?? FALLBACK;
  const name = tool.name.replace(/ \(.+\)$/, "");
  const sub = stripAi(tool.subcategory || tool.category);
  const cur = CURATED[name.toLowerCase()];
  const generic: ToolContent = {
    description: `${name} is an AI tool in the ${sub} category. People use it to ${tpl.purpose}. TryAITools summarizes what it's typically used for here, so check the official website for current features and pricing.`,
    useCases: [`Everyday ${sub.toLowerCase()} tasks with ${name}`, ...tpl.useCases],
    features: tpl.features,
    pros: ["Can save time on routine work", "Quick to try with a free or trial plan if offered", "Fits into an existing workflow in the " + shortName(tool.category) + " space"],
    limits: ["AI output can contain mistakes, so review it", "Features, limits and pricing change; confirm on the official site", "Check the privacy terms before sharing sensitive data"],
    audience: tpl.audience,
    prompt: fill(tpl.prompt, tool),
    steps: tpl.steps.map((s) => fill(s, tool)),
    tips: tpl.tips,
    curated: false,
  };
  if (!cur) return generic;
  return {
    ...generic,
    ...cur,
    useCases: cur.useCases ?? generic.useCases,
    description: cur.description,
    curated: true,
  };
}
