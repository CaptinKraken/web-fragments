export const uwu = /*javascript*/ `
;(function () {

document.addEventListener('keydown', (e) => {
  const keys = [' ', 'Enter'];
  if (keys.includes(e.key)) {
    e.preventDefault();
  }
  if (e.key === 'Escape') {
    e.preventDefault();
  }
});

})();
`;
