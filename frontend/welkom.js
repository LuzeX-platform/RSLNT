// Het portaal: wie al ingelogd is, gaat meteen naar zijn trainingen.
haalSessie().then((g) => {
  if (g && !g.offline) window.location.replace("/");
});
