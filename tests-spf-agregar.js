// Casos a agregar en tests.html para el nuevo spfScoreOf.
// Regla 6 de ARQUITECTURA: todo cambio en pure.js actualiza tests.html.

// — Equivalencia entre sistemas: PA++++ y el sello UVA europeo en un SPF50
//   miden la MISMA magnitud (PPD ≥16 vs UVA-PF ≥ SPF/3 = 16.7). Deben empatar.
t('spf: PA++++ y sello UVA UE puntúan igual',
  spfScoreOf({ tags: [{ cls: 'pa4' }] }),
  spfScoreOf({ tags: [{ cls: 'euuva' }] }));

// — No se acumulan: llevar ambas etiquetas no protege más que llevar una.
t('spf: pa4 + euuva no se suman',
  spfScoreOf({ tags: [{ cls: 'pa4' }, { cls: 'euuva' }] }), 60);

// — Magnitud sola. Pesos calibrados a manchas solares: 60/30/10.
t('spf: PA++++ solo', spfScoreOf({ tags: [{ cls: 'pa4' }] }), 60);
t('spf: PA+++ solo',  spfScoreOf({ tags: [{ cls: 'pa3' }] }), 43);
t('spf: PA++ solo',   spfScoreOf({ tags: [{ cls: 'pa2' }] }), 27);

// — Sin dato UVA: piso de amplio espectro, no cero.
t('spf: sin dato UVA', spfScoreOf({ tags: [] }), 21);
t('spf: tags cosméticos no puntúan',
  spfScoreOf({ tags: [{ cls: 'clear' }, { cls: 'best' }] }), 21);

// — Espectro: excluyente, se toma el mejor.
t('spf: UVA400 sobre PA++++',        spfScoreOf({ tags: [{ cls: 'pa4' }, { cls: 'uva400' }] }), 90);
t('spf: UVA largos sobre PA++++',    spfScoreOf({ tags: [{ cls: 'pa4' }, { cls: 'uvalong' }] }), 75);
t('spf: uva400 y uvalong no se suman',
  spfScoreOf({ tags: [{ cls: 'pa4' }, { cls: 'uva400' }, { cls: 'uvalong' }] }), 90);

// — Luz visible (óxidos de hierro). Pesa 10 en lentigos (en melasma pesaría más).
t('spf: tintado suma 10', spfScoreOf({ tags: [{ cls: 'pa4' }, { cls: 'tinted' }] }), 70);

// — Techo.
t('spf: máximo 100',
  spfScoreOf({ tags: [{ cls: 'pa4' }, { cls: 'uva400' }, { cls: 'tinted' }] }), 100);

// — Regresión de los dos que estaban mal puntuados por falta de etiqueta.
t('spf: Anthelios UV AIR (euuva+tinted)',
  spfScoreOf({ tags: [{ cls: 'euuva' }, { cls: 'tinted' }] }), 70);
t('spf: Nivea stick europeo (euuva)',
  spfScoreOf({ tags: [{ cls: 'euuva' }] }), 60);
