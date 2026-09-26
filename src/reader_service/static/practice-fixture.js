// Reader 2.0 prototype only. Coordinates were checked against the original
// 2026 计算机组成原理 PDF (sections 1.2.6 and 5.2.4). Never apply to another source revision.
export const PRACTICE_BOOK_SHA256 = "6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd";

// Each rectangle is normalized [left, top, right, bottom] on the PDF page.
// The narrow padding includes the printed option while leaving the question
// body and surrounding text available for ordinary PDF selection.
export const PRACTICE_QUESTIONS = [
  {number: 1, promptY: 0.748, page: 19, answerPage: 21, answerY: .72, options: [[.19,.765,.44,.785],[.52,.765,.70,.785],[.19,.785,.37,.805],[.52,.785,.79,.805]]},
  {number: 2, promptY: 0.808, page: 19, answerPage: 21, answerY: .76, options: [[.19,.825,.37,.845],[.52,.825,.74,.845],[.19,.845,.37,.865],[.52,.845,.71,.865]]},
  {number: 3, promptY: 0.869, page: 19, answerPage: 21, answerY: .84, options: [[.19,.885,.39,.905],[.52,.885,.79,.905],[.19,.905,.32,.925],[.52,.905,.76,.925]]},
  {number: 4, promptY: 0.102, page: 20, answerPage: 21, answerY: .90, options: [[.17,.119,.36,.139],[.17,.140,.58,.160],[.17,.160,.65,.180],[.17,.180,.45,.200]]},
  {number: 5, promptY: 0.203, page: 20, answerPage: 22, answerY: .14, options: [[.17,.220,.27,.241],[.33,.220,.41,.241],[.50,.220,.60,.241],[.67,.220,.75,.241]]},
  {number: 6, promptY: 0.243, page: 20, answerPage: 22, answerY: .20, options: [[.17,.260,.25,.281],[.33,.260,.43,.281],[.50,.260,.60,.281],[.67,.260,.75,.281]]},
  {number: 7, promptY: 0.284, page: 20, answerPage: 22, answerY: .24, options: [[.17,.301,.32,.322],[.50,.301,.70,.322],[.17,.321,.32,.342],[.50,.321,.65,.342]]},
  {number: 8, promptY: 0.344, page: 20, answerPage: 22, answerY: .30, options: [[.17,.361,.41,.382],[.50,.361,.72,.382],[.17,.382,.43,.402],[.50,.382,.74,.402]]},
  // The printed A and B for question 09 share one OCR line; the two hit areas
  // are explicitly split at the option boundary on the original page.
  {number: 9, promptY: 0.403, page: 20, answerPage: 22, answerY: .36, options: [[.17,.422,.31,.442],[.31,.422,.46,.442],[.50,.422,.60,.442],[.67,.422,.82,.442]]},
  {number: 10, promptY: 0.444, page: 20, answerPage: 22, answerY: .44, options: [[.17,.462,.42,.483],[.50,.462,.75,.483],[.17,.482,.42,.503],[.50,.482,.75,.503]]},
  {number: 11, promptY: 0.505, page: 20, answerPage: 22, answerY: .50, options: [[.17,.523,.26,.543],[.33,.523,.43,.543],[.50,.523,.60,.543],[.67,.523,.78,.543]]},
  {number: 12, promptY: 0.545, page: 20, answerPage: 22, answerY: .56, options: [[.17,.563,.31,.584],[.33,.563,.43,.584],[.50,.563,.60,.584],[.67,.563,.80,.584]]},
  {number: 13, promptY: 0.586, page: 20, answerPage: 22, answerY: .60, options: [[.17,.603,.78,.624],[.17,.624,.54,.644],[.17,.644,.54,.664],[.17,.663,.84,.684]]},
  {number: 14, promptY: 0.686, page: 20, answerPage: 22, answerY: .70, options: [[.17,.724,.28,.744],[.33,.724,.44,.744],[.50,.724,.60,.744],[.67,.724,.76,.744]]},
  {number: 15, promptY: 0.747, page: 20, answerPage: 22, answerY: .76, options: [[.17,.805,.27,.825],[.33,.805,.44,.825],[.50,.805,.60,.825],[.67,.805,.78,.825]]},
  {number: 16, promptY: 0.827, page: 20, answerPage: 22, answerY: .82, options: [[.17,.845,.62,.865],[.17,.865,.60,.885],[.17,.885,.84,.905],[.17,.905,.44,.925]]},
];

// 5.2.4: OCR line quads supplied the headings and A/B/C/D rectangles; the
// matching 5.2.5 answer headings supplied the destinations. PDF 228–229.
// A question may name multiple page regions. Only printed 09 needs that
// extension; the existing single-page fixtures retain their compact shape.
export const PRACTICE_QUESTIONS_524 = [
  {number: 101, label: 1, page: 227, promptY: .288, answerPage: 228, answerY: .749, options: [[.188,.306,.310,.326],[.348,.306,.471,.326],[.518,.306,.641,.327],[.684,.306,.806,.327]]},
  {number: 102, label: 2, page: 227, promptY: .329, answerPage: 228, answerY: .832, options: [[.187,.345,.312,.367],[.349,.346,.471,.366],[.518,.346,.640,.367],[.684,.346,.806,.367]]},
  {number: 103, label: 3, page: 227, promptY: .369, answerPage: 228, answerY: .893, options: [[.188,.386,.497,.406],[.188,.407,.439,.426],[.188,.426,.643,.447],[.188,.446,.345,.466]]},
  {number: 104, label: 4, page: 227, promptY: .469, answerPage: 229, answerY: .110, options: [[.187,.486,.246,.507],[.348,.486,.408,.506],[.519,.486,.577,.507],[.684,.485,.807,.507]]},
  {number: 105, label: 5, page: 227, promptY: .509, answerPage: 229, answerY: .172, options: [[.188,.525,.364,.545],[.519,.526,.712,.545],[.188,.546,.382,.566],[.520,.546,.714,.566]]},
  {number: 106, label: 6, page: 227, promptY: .568, answerPage: 229, answerY: .213, options: [[.189,.586,.494,.605],[.188,.605,.622,.625],[.188,.625,.474,.645],[.188,.645,.530,.665]]},
  {number: 107, label: 7, page: 227, promptY: .667, answerPage: 229, answerY: .254, options: [[.189,.685,.716,.704],[.189,.705,.473,.724],[.188,.724,.696,.745],[.188,.744,.531,.765]]},
  {number: 108, label: 8, page: 227, promptY: .767, answerPage: 229, answerY: .316, options: [[.189,.785,.568,.804],[.188,.804,.584,.824],[.188,.824,.530,.844],[.188,.844,.596,.864]]},
  {number: 109, label: 9, page: 227, promptY: .874, answerPage: 229, answerY: .418, regions: [
    {page: 227, options: [{choice: "A", rect: [.189,.886,.679,.902]}, {choice: "B", rect: [.189,.905,.714,.922]}]},
    {page: 228, options: [{choice: "C", rect: [.174,.101,.698,.117]}, {choice: "D", rect: [.173,.120,.718,.137]}]},
  ]},
  {number: 110, label: 10, page: 228, promptY: .142, answerPage: 229, answerY: .541, options: [[.173,.158,.679,.179],[.172,.178,.678,.198],[.172,.198,.678,.218],[.173,.219,.680,.238]]},
  {number: 111, label: 11, page: 228, promptY: .242, answerPage: 229, answerY: .624, options: [[.174,.259,.478,.278],[.172,.278,.643,.298],[.173,.298,.716,.318],[.171,.317,.275,.338]]},
  {number: 112, label: 12, page: 228, promptY: .341, answerPage: 229, answerY: .685, options: [[.171,.356,.275,.377],[.334,.356,.436,.377],[.502,.356,.605,.377],[.668,.357,.791,.378]]},
  {number: 113, label: 13, page: 228, promptY: .380, answerPage: 229, answerY: .767, options: [[.173,.398,.675,.417],[.172,.417,.752,.437],[.173,.438,.654,.457],[.172,.457,.730,.477]]},
  {number: 114, label: 14, page: 228, promptY: .480, answerPage: 229, answerY: .828, options: [[.173,.517,.404,.536],[.504,.517,.733,.536],[.173,.537,.386,.556],[.504,.536,.773,.557]]},
  {number: 115, label: 15, page: 228, promptY: .559, answerPage: 230, answerY: .109, options: [[.173,.597,.523,.616],[.173,.616,.615,.636],[.173,.637,.679,.656],[.172,.655,.662,.676]]},
];

export const PRACTICE_SECTIONS = [
  {id: "126", title: "1.2.6 本节习题精选", entryPage: 19, entryTop: .6951, entryBottom: .7102, entryLeft: .364, questions: PRACTICE_QUESTIONS},
  {id: "524", title: "5.2.4 本节习题精选", entryPage: 227, entryTop: .2369, entryBottom: .2535, entryLeft: .366, questions: PRACTICE_QUESTIONS_524},
];
const VERIFIED_DEMO_SECTIONS = [...PRACTICE_SECTIONS];

export function replacePracticeSections(sections) {
  if (!Array.isArray(sections) || !sections.length) {
    PRACTICE_SECTIONS.splice(0, PRACTICE_SECTIONS.length, ...VERIFIED_DEMO_SECTIONS);
    return;
  }
  const merged = sections.map(section => ({...section, questions: [...section.questions]}));
  for (const verified of VERIFIED_DEMO_SECTIONS) {
    const section = merged.find(item => item.id === verified.id);
    if (!section) { merged.push(verified); continue; }
    const available = new Set(section.questions.map(question => question.number));
    section.questions.push(...verified.questions.filter(question => !available.has(question.number)));
    section.questions.sort((a, b) => (a.label ?? a.number) - (b.label ?? b.number));
  }
  merged.sort((a, b) => a.entryPage - b.entryPage);
  PRACTICE_SECTIONS.splice(0, PRACTICE_SECTIONS.length, ...merged);
}

export function practiceQuestionForPage(page, question) {
  if (!question) return null;
  const regions = question.regions || [{page: question.page,
    options: question.options.map((rect, index) => ({choice: "ABCD"[index], rect}))}];
  return regions.find(region => region.page === page) || null;
}

export function practiceChoiceAt(region, x, y) {
  return region?.options.find(({rect: [x0,y0,x1,y1]}) => x >= x0 && x <= x1 && y >= y0 && y <= y1)?.choice || null;
}
