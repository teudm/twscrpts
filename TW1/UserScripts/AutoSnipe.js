const allTroopsBtn = document.querySelector('#selectAllUnits');

const allCommands = document.querySelectorAll('#commands_incomings .command-row');

const targetCoord = "431|475";

const urlParams = new URLSearchParams(window.location.search);
const villageId = urlParams.get('village') || TribalWars.getGameData().village.id;

function createForm(troopsData, coords) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/game.php?village=' + villageId + '&screen=place&action=command';
  // form.style.display = 'none';
  form.onsubmit = "this.submit.disabled=true;";

  const inputSupport = document.createElement('input');
  inputSupport.type = 'hidden';
  inputSupport.name = 'support';
  inputSupport.value = 'true';
  form.appendChild(inputSupport);

  const inputX = document.createElement('input');
  inputX.type = 'hidden';
  inputX.name = 'x';
  inputX.value = coords.split('|')[0];
  form.appendChild(inputX);

  const inputY = document.createElement('input');
  inputY.type = 'hidden';
  inputY.name = 'y';
  inputY.value = coords.split('|')[1];
  form.appendChild(inputY);

  const inputSourceVillage = document.createElement('input');
  inputSourceVillage.type = 'hidden';
  inputSourceVillage.name = 'source_village';
  inputSourceVillage.value = villageId;
  form.appendChild(inputSourceVillage);

  const inputVillage = document.createElement('input');
  inputVillage.type = 'hidden';
  inputVillage.name = 'village';
  inputVillage.value = villageId;
  form.appendChild(inputVillage);

  for (const troopType in troopsData) {
    const inputTroop = document.createElement('input');
    inputTroop.type = 'hidden';
    inputTroop.name = troopType;
    inputTroop.value = troopsData[troopType];
    form.appendChild(inputTroop);
  }

  const inputSubmit = document.createElement('input');
  inputSubmit.type = 'submit';
  inputSubmit.name = 'submit';
  inputSubmit.value = 'Enviar';
  form.appendChild(inputSubmit);

  document.body.appendChild(form);
  return form;
}



allCommands.forEach(command => {
    const snipeBtn = document.createElement('button');
    snipeBtn.textContent = 'Snipe';
    snipeBtn.classList.add('auto-snipe-btn');
    snipeBtn.style.color = 'black';

    const commandEndTime = command.querySelector('span[data-endtime]');
    const commandMs = parseInt(command.querySelector('span.grey.small').innerHTML);
    if (commandEndTime) {
        const T_arrival = parseInt(commandEndTime.getAttribute('data-endtime') * 1000 + commandMs);
        const T_return_desired = T_arrival + 1;
        snipeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log(`Botão Snipe clicado. Retorno desejado: ${new Date(T_return_desired).toISOString()}`);
            const snipeData = {
                targetVillage: villageId,
                returnTime: T_return_desired
            };
        });
    }
    command.appendChild(snipeBtn);
});

const form = createForm({'axe': 1, 'spy': 1}, targetCoord);
    
document.querySelector('body').appendChild(form);

