// Reader 2.0 prototype only. Coordinates were checked against the original
// 2026 计算机组成原理 PDF, pages 20–23. Never apply to another source revision.
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

export function practiceQuestionForPage(page, questionIndex) {
  const question = PRACTICE_QUESTIONS[questionIndex];
  return question?.page === page ? question : null;
}

export function practiceChoiceAt(question, x, y) {
  const index = question?.options.findIndex(([x0,y0,x1,y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1) ?? -1;
  return index < 0 ? null : "ABCD"[index];
}
