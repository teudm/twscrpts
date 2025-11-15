// ==UserScript==
// @name         Planejador de Ataques (v11.0 - Layout Nativo)
// @version      1.0
// @description  Agenda ataques POST, UI idêntica à praça, cópia, ajuste 200ms, coloração, e cache 24h.
// @author       TeudM
// @match        https://*.tribalwars.com.br/game.php?*screen=place*
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// @icon         https://www.google.com/s2/favicons?sz=64&domain=tribalwars.com.br
// @downloadURL  https://raw.githubusercontent.com/teudm/twscrpts/main/TW1/UserScripts/AtackPlanner.user.js
// @updateURL    https://github.com/teudm/tribalwars/raw/main/TW1/UserScripts/AtackPlanner.user.js
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use-strict';

    // --- Constantes e Globais ---
    const STORAGE_KEY_PREFIX = 'TW_AttackPlanner_POST_';
    const currentVillageID = game_data.village.id;
    const STORAGE_KEY = `${STORAGE_KEY_PREFIX}${currentVillageID}`;
    const MIN_ATTACK_INTERVAL_MS = 200;

    const VILLAGE_CACHE_KEY = 'TW_VILLAGE_DATA_CACHE';
    const PLAYER_CACHE_KEY = 'TW_PLAYER_DATA_CACHE';
    const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

    let villageDataMap = new Map();
    let playerDataMap = new Map();
    let isDataFetching = false;
    
    let pendingTimers = {};

    GM_addStyle(`
        #plannedAttacksList  .vis td { 
            padding: 3px; 
            border-bottom: 1px solid #F4E3BC; 
        }
        #planner-container .vis th {
            padding: 3px;
        }
        .copy-attack { margin-left: 5px; }
        #planner-container td { padding: 4px; }
        
        /* Cores da tabela de resultados */
        .planner-row-fake td { background-color: rgba(0, 126, 143, 0.5) !important; }
        .planner-row-noble td { background-color: rgba(0, 167, 14, 0.5) !important; }
        .planner-row-spy td { background-color: rgba(143, 143, 143, 0.5) !important; }
        .planner-row-heavy td { background-color: rgba(233, 74, 0, 0.5) !important; }
        
        #planner-data-status {
            display: none; padding: 5px; text-align: center; 
            background-color: #fff3e0; border: 1px solid #825e2e; 
            color: #825e2e; font-weight: bold; margin-bottom: 10px; border-radius: 5px;
        }
    `);

    // --- 1. Lógica Principal de Verificação ---

    function checkPlannedAttacks() {
        const serverTime = parseServerTime();
        if (!serverTime) return;

        updateCountdowns(serverTime);

        const attacks = getAttacksFromStorage();
        const serverTimeMs = serverTime.getTime();

        for (const attack of attacks) {
            if (attack.originID !== currentVillageID) continue;
            if (pendingTimers[attack.id]) continue;

            const dueTime = new Date(attack.departureTime).getTime();
            const msRemaining = dueTime - serverTimeMs;

            if (msRemaining < -1000) {
                console.log(`[PLANEJADOR] Ataque ${attack.id} está atrasado. Travando e disparando.`);
                pendingTimers[attack.id] = true;
                triggerAttack(attack);
                break; 
            }

            if (msRemaining > 0 && msRemaining < 20000) {
                console.log(`[PLANEJADOR] Agendando timer para ${attack.id}.`);
                const timerId = setTimeout(() => {
                    triggerAttack(attack);
                }, msRemaining);
                pendingTimers[attack.id] = timerId;
            }
        }
    }

    function triggerAttack(attack) {
        console.log(`[PLANEJADOR] Disparando Etapa 1 para ataque ${attack.id}`);
        sendAttackPOST_Step1(attack); 
    }

    // --- 2. Lógica de Envio (POST - 2 Etapas) ---

    function sendAttackPOST_Step1(attack) {
        const $form = $('#command-data-form');
        if ($form.length === 0) {
            console.error('[PLANEJADOR] Formulário #command-data-form não encontrado.');
            delete pendingTimers[attack.id];
            return;
        }

        const postURL = $form.attr('action');
        let postData = {};
        $form.find('input[type=hidden]').each(function() {
            postData[$(this).attr('name')] = $(this).val();
        });

        postData.x = attack.targetX;
        postData.y = attack.targetY;

        const allUnits = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];
        allUnits.forEach(unit => {
            postData[unit] = attack.units[unit] || 0;
        });

        postData.attack = "Ataque"; 

        console.log('[PLANEJADOR] Etapa 1: Enviando POST para:', postURL, postData);

        $.post(postURL, postData)
            .done(function(responseHTML) {
                if (typeof responseHTML === 'string' && responseHTML.includes('command-data-form')) {
                    sendAttackPOST_Step2(responseHTML, attack);
                } else if (typeof responseHTML === 'string' && responseHTML.includes('Comando inválido')) {
                    console.warn(`[PLANEJADOR] Etapa 1 FALHOU: "Comando inválido".`, postData);
                    delete pendingTimers[attack.id];
                } else {
                     console.warn(`[PLANEJADOR] Etapa 1: Resposta inesperada.`, responseHTML);
                     delete pendingTimers[attack.id];
                }
            })
            .fail(function(xhr) {
                console.error(`[PLANEJADOR] Falha crítica no POST (Etapa 1) para ${attack.id}.`, xhr);
                delete pendingTimers[attack.id];
            });
    }

    function sendAttackPOST_Step2(confirmationHTML, originalAttack) {
        console.log(`[PLANEJADOR] Etapa 2: Processando confirmação para ${originalAttack.id}.`);
        try {
            const $response = $(confirmationHTML);
            const $confirmForm = $response.find('#command-data-form');
            if ($confirmForm.length === 0) {
                console.error('[PLANEJADOR] Etapa 2: Não foi possível encontrar "#command-data-form".');
                delete pendingTimers[originalAttack.id];
                return;
            }

            const finalPostURL = $confirmForm.attr('action');
            let finalPostData = {};
            $confirmForm.find('input[type=hidden]').each(function() {
                finalPostData[$(this).attr('name')] = $(this).val();
            });

            const $submitButton = $confirmForm.find('input[type=submit][name="attack"], input[type=submit][name="submit"]');
            finalPostData[$submitButton.attr('name')] = $submitButton.val();

            console.log('[PLANEJADOR] Etapa 2: Enviando POST final para:', finalPostURL, finalPostData);

            $.post(finalPostURL, finalPostData)
                .done(function(finalResponse) {
                    if (finalResponse.redirect || (typeof finalResponse === 'string' && finalResponse.includes('screen=overview"'))) {
                         console.log(`[PLANEJADOR] *** ATAQUE ENVIADO COM SUCESSO: ${originalAttack.id} ***`);
                         removeAttackFromStorage(originalAttack.id);
                         renderAttackList(); 
                         delete pendingTimers[originalAttack.id];
                         checkSafeToReload(); 
                    } else {
                        console.warn('[PLANEJADOR] Etapa 2: Resposta inesperada.', finalResponse);
                        delete pendingTimers[originalAttack.id];
                    }
                })
                .fail(function(xhr) {
                    console.error('[PLANEJADOR] Etapa 2: Falha crítica no POST final.', xhr);
                    delete pendingTimers[originalAttack.id];
                });

        } catch (e) {
            console.error('[PLANEJADOR] Etapa 2: Erro ao parsear HTML.', e);
            delete pendingTimers[originalAttack.id];
        }
    }

    function checkSafeToReload() {
        const attacks = getAttacksFromStorage();
        if (attacks.length === 0) {
            console.log('[PLANEJADOR] Todos os ataques enviados. Recarregando.');
            setTimeout(() => location.reload(), 250);
            return;
        }

        const now = (parseServerTime() || new Date()).getTime();
        const safetyWindowMs = 10000;
        const isAnyAttackImminent = attacks.some(att => {
            if (pendingTimers[att.id]) return false; 
            const dueTime = new Date(att.departureTime).getTime();
            const diff = Math.abs(dueTime - now);
            return diff <= safetyWindowMs;
        });

        if (isAnyAttackImminent) {
            console.log('[PLANEJADOR] Refresh adiado. Ataque iminente (janela de 10s).');
        } else {
            console.log('[PLANEJADOR] Janela de 10s livre. Recarregando a página.');
            setTimeout(() => location.reload(), 250);
        }
    }

    // --- 3. Funções de Relógio e Countdown ---

    function parseServerTime() {
        try {
            const dateStr = $('#serverDate').text();
            const timeStr = $('#serverTime').text();
            if (!dateStr || !timeStr) return null;
            const [day, month, year] = dateStr.split('/');
            const [hour, minute, second] = timeStr.split(':');
            return new Date(year, month - 1, day, hour, minute, second);
        } catch (e) { return null; }
    }

    function updateCountdowns(serverTime) {
        const serverTimeMs = serverTime.getTime();
        $('.attack-countdown').each(function() {
            const departureTime = $(this).data('departure');
            const msRemaining = new Date(departureTime).getTime() - serverTimeMs;
            $(this).text(formatTimeRemaining(msRemaining));
        });
    }

    function formatTimeRemaining(ms) {
        if (ms <= 0) return "Enviando...";
        let seconds = Math.floor(ms / 1000);
        let minutes = Math.floor(seconds / 60);
        let hours = Math.floor(minutes / 60);
        seconds = seconds % 60;
        minutes = minutes % 60;
        const pad = (n) => (n < 10 ? '0' + n : n);
        return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }

    // --- 4. Funções de Armazenamento ---

    function getAttacksFromStorage() {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    }
    function saveAttacksToStorage(attacks) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(attacks));
    }
    function removeAttackFromStorage(attackId) {
        let attacks = getAttacksFromStorage();
        attacks = attacks.filter(att => att.id != attackId);
        saveAttacksToStorage(attacks);
    }
    
    // --- 5. Funções de Cache e Dados do Mundo ---

    async function initializeData() {
        const cachedVillages = JSON.parse(localStorage.getItem(VILLAGE_CACHE_KEY) || '{}');
        const cachedPlayers = JSON.parse(localStorage.getItem(PLAYER_CACHE_KEY) || '{}');
        const now = Date.now();

        if (!cachedVillages.timestamp || (now - cachedVillages.timestamp > CACHE_DURATION_MS) ||
            !cachedPlayers.timestamp || (now - cachedPlayers.timestamp > CACHE_DURATION_MS)) {
            
            console.log('[PLANEJADOR] Cache expirado ou ausente. Buscando novos dados do mundo...');
            await fetchWorldData();
        } else {
            console.log('[PLANEJADOR] Carregando dados do mundo (vilas/jogadores) do cache.');
            loadDataFromCache(cachedVillages, cachedPlayers);
        }
    }

    function loadDataFromCache(cachedVillages, cachedPlayers) {
        try {
            villageDataMap = new Map(cachedVillages.data);
            playerDataMap = new Map(cachedPlayers.data);
        } catch (e) {
            console.error('[PLANEJADOR] Erro ao carregar cache, forçando re-fetch.', e);
            fetchWorldData();
        }
    }

    async function fetchWorldData() {
        if (isDataFetching) return;
        isDataFetching = true;

        $('#planner-data-status').text('Atualizando informações das aldeias deste mundo...').show();
        $('#addAttackPOSTForm input[type=submit]').prop('disabled', true).val('Carregando dados...');

        try {
            const [villageResp, playerResp] = await Promise.all([
                fetch('/map/village.txt'),
                fetch('/map/player.txt')
            ]);

            const villageText = await villageResp.text();
            const playerText = await playerResp.text();

            villageDataMap.clear();
            villageText.trim().split('\n').forEach(line => {
                const [id, name, x, y, playerId] = line.split(',');
                villageDataMap.set(`${x},${y}`, {
                    id: Number(id),
                    name: decodeURIComponent(name.replace(/\+/g, ' ')),
                    playerId: Number(playerId)
                });
            });
            
            playerDataMap.clear();
            playerText.trim().split('\n').forEach(line => {
                const [id, name] = line.split(',');
                playerDataMap.set(Number(id), {
                    name: decodeURIComponent(name.replace(/\+/g, ' '))
                });
            });
            
            playerDataMap.set(0, { name: 'Bárbaro' });

            localStorage.setItem(VILLAGE_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: Array.from(villageDataMap.entries()) }));
            localStorage.setItem(PLAYER_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: Array.from(playerDataMap.entries()) }));
            
            console.log('[PLANEJADOR] Dados do mundo (vilas/jogadores) atualizados e salvos no cache.');

        } catch (e) {
            console.error('[PLANEJADOR] Falha ao baixar dados do mundo (village.txt/player.txt).', e);
            $('#planner-data-status').text('Erro ao atualizar dados. Recarregue a página.').show();
        } finally {
            isDataFetching = false;
            setTimeout(() => $('#planner-data-status').fadeOut(500), 2000);
            $('#addAttackPOSTForm input[type=submit]').prop('disabled', false).val('Agendar Ataque');
        }
    }


    // --- 6. UI (Interface Integrada) ---

    function injectPlannerUI() {
        const unitsInGame = game_data.units; 
        const buildUnitTable = (title, units) => {
            let rows = `<tr><th>${title}</th></tr>`;
            units.forEach(unit => {
                if (unitsInGame.includes(unit)) {
                    rows += `<tr><td class="nowrap">
                               <a class="unit_link" data-unit="${unit}"><img src="/graphic/unit/unit_${unit}.png" alt=""></a> 
                               <input name="${unit}" type="text" class="unit-input unitsInput">
                             </td></tr>`;
                }
            });
            return `<table class="vis" width="100%">${rows}</table>`;
        };
        
        const infantryTable = buildUnitTable('Infantaria', ['spear', 'sword', 'axe', 'archer']);
        const cavalryTable = buildUnitTable('Cavalaria', ['spy', 'light', 'marcher', 'heavy']);
        const siegeTable = buildUnitTable('Armas de cerco', ['ram', 'catapult']);
        const otherTable = buildUnitTable('Outros', ['knight', 'snob']);

        const plannerHTML = `
            <div id="planner-container" style="margin-top: 20px;">
                <hr>
                <div id="planner-data-status"></div>
                
                <h3>Agendar Ataque (Planejador)</h3>
                <form id="addAttackPOSTForm">
                    <table class="vis" style="width: 100%;">
                        <tr>
                            <td>Alvo (X|Y):</td>
                            <td><input type="text" id="plannerX" size="5" /> | <input type="text" id="plannerY" size="5" /></td>
                        </tr>
                        <tr>
                            <td>Saída:</td>
                            <td>
                                <input type="datetime-local" id="plannerTime" step="1" />
                                MS: <input type="number" id="plannerMS" size="3" min="0" max="999" value="0" />
                            </td>
                        </tr>
                        <tr>
                            <td>Tipo:</td>
                            <td>
                                <label style="font-weight: bold;">
                                    <input type="checkbox" id="plannerFake" /> Marcar como FAKE
                                </label>
                            </td>
                        </tr>
                    </table>
                    
                    <table style="width: 100%; margin-top: 5px;">
                        <tbody>
                            <tr>
                                <td valign="top" style="width: 25%;">${infantryTable}</td>
                                <td valign="top" style="width: 25%;">${cavalryTable}</td>
                                <td valign="top" style="width: 25%;">${siegeTable}</td>
                                <td valign="top" style="width: 25%;">${otherTable}</td>
                            </tr>
                        </tbody>
                    </table>
                    <br>
                    <input type="submit" class="btn btn-premium" value="Agendar Ataque" />
                </form>

                <hr>
                <h3>Ataques Agendados (Apenas desta Aldeia)</h3>
                <div id="plannedAttacksList"></div>
            </div>
        `;
        
        const wrappedHTML = `
            <tr>
                <td id="planner_cell_container" style="padding: 10px;" colspan="100%">
                    ${plannerHTML}
                </td>
            </tr>
        `;

        const $targetTbody = $('#content_value').closest('table.main').find('tbody').first(); 
        if ($targetTbody.length > 0) {
            $targetTbody.append(wrappedHTML);
        } else {
            $('#command-data-form').after(plannerHTML);
        }
    }

    function bindUIEvents() {
        $('#addAttackPOSTForm').on('submit', handleAddAttack);
        $('#plannedAttacksList').on('click', '.delete-attack', handleDeleteAttack);
        $('#plannedAttacksList').on('click', '.copy-attack', handleCopyAttack);
    }

    function handleAddAttack(e) {
        e.preventDefault();

        const targetX = $('#plannerX').val();
        const targetY = $('#plannerY').val();
        if (!targetX || !targetY) { alert('Insira as coordenadas de destino.'); return; }

        const villageInfo = villageDataMap.get(`${targetX},${targetY}`);
        if (!villageInfo) {
            alert('Aldeia não encontrada. Verifique as coordenadas ou aguarde a atualização dos dados.');
            return;
        }
        const playerInfo = playerDataMap.get(villageInfo.playerId);
        const ownerName = playerInfo ? playerInfo.name : 'Desconhecido';

        const baseTime = $('#plannerTime').val();
        if (!baseTime) { alert('Insira data e hora.'); return; }

        let departureDate = new Date(baseTime);
        const milliseconds = parseInt($('#plannerMS').val() || 0);
        departureDate.setMilliseconds(milliseconds);
        
        const serverTime = parseServerTime() || new Date();
        if (departureDate.getTime() <= serverTime.getTime()) {
            alert('O horário de saída deve ser no futuro. Por favor, insira um horário válido.');
            return;
        }
        const newAttackTime = departureDate.getTime();
        const attacks = getAttacksFromStorage();
        const sameTargetAttacks = attacks.filter(a => a.targetX === targetX && a.targetY === targetY);
        if (sameTargetAttacks.length > 0) {
            const maxTime = Math.max(...sameTargetAttacks.map(a => new Date(a.departureTime).getTime()));
            if (newAttackTime < (maxTime + MIN_ATTACK_INTERVAL_MS)) {
                const adjustedTime = maxTime + MIN_ATTACK_INTERVAL_MS;
                departureDate.setTime(adjustedTime); 
                alert(`Ajuste Automático: O tempo de envio foi ajustado para ${departureDate.toLocaleString('pt-BR', { timeStyle: 'medium' })}.${String(departureDate.getMilliseconds()).padStart(3, '0')} para manter o intervalo mínimo de ${MIN_ATTACK_INTERVAL_MS}ms.`);
                $('#plannerTime').val(formatDateForInput(departureDate));
                $('#plannerMS').val(departureDate.getMilliseconds());
            }
        }

        const units = {};
        let totalUnits = 0;
        $('#addAttackPOSTForm .unit-input').each(function() {
            const unitName = $(this).attr('name');
            const unitCount = parseInt($(this).val() || 0);
            if (unitCount > 0) {
                units[unitName] = unitCount;
                totalUnits += unitCount;
            }
        });
        if (totalUnits === 0) { alert('Insira pelo menos uma tropa.'); return; }

        const isFake = $('#plannerFake').is(':checked');

        const newAttack = {
            id: Date.now(),
            originID: currentVillageID,
            departureTime: departureDate.toISOString(),
            targetX: targetX,
            targetY: targetY,
            units: units,
            isFake: isFake,
            villageName: villageInfo.name,
            ownerName: ownerName
        };

        attacks.push(newAttack);
        attacks.sort((a, b) => new Date(a.departureTime) - new Date(b.departureTime));
        saveAttacksToStorage(attacks);

        renderAttackList();

        $('#plannerX').val('');
        $('#plannerY').val('');
        $('#plannerTime').val('');
        $('#plannerMS').val('0');
        $('#addAttackPOSTForm .unit-input').val('');
        $('#plannerFake').prop('checked', false);
    }

    function handleDeleteAttack() {
        const attackId = $(this).data('id');
        if (pendingTimers[attackId]) {
            clearTimeout(pendingTimers[attackId]);
            delete pendingTimers[attackId];
        }
        removeAttackFromStorage(attackId);
        renderAttackList();
    }
    
    function handleCopyAttack() {
        const attackId = $(this).data('id');
        const attacks = getAttacksFromStorage();
        const attackToCopy = attacks.find(att => att.id == attackId);
        if (!attackToCopy) return;

        $('#plannerX').val(attackToCopy.targetX);
        $('#plannerY').val(attackToCopy.targetY);

        const departureDate = new Date(attackToCopy.departureTime);
        $('#plannerTime').val(formatDateForInput(departureDate));
        $('#plannerMS').val(departureDate.getMilliseconds());
        $('#plannerFake').prop('checked', attackToCopy.isFake || false);

        $('#addAttackPOSTForm .unit-input').val('');
        for (const unitName in attackToCopy.units) {
            $(`#addAttackPOSTForm .unit-input[name="${unitName}"]`).val(attackToCopy.units[unitName]);
        }
        
        document.getElementById('planner-container').scrollIntoView({ behavior: 'smooth' });
    }

    function formatDateForInput(date) {
        const pad = (num) => String(num).padStart(2, '0');
        const year = date.getFullYear();
        const month = pad(date.getMonth() + 1);
        const day = pad(date.getDate());
        const hours = pad(date.getHours());
        const minutes = pad(date.getMinutes());
        const seconds = pad(date.getSeconds());
        return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
    }

    function renderAttackList() {
        const $list = $('#plannedAttacksList');
        $list.empty();
        const attacks = getAttacksFromStorage();

        if (attacks.length === 0) {
            $list.html(`<p>Nenhum ataque agendado para ${game_data.village.name}.</p>`);
            return;
        }

        const $table = $('<table>', { class: 'vis', width: '100%' });
        $table.append('<tr><th>Alvo (Jogador)</th><th>Tropas</th><th>Hora Saída</th><th>Faltam</th><th>Ação</th></tr>');

        const serverTime = parseServerTime() || new Date();

        attacks.forEach(att => {
            const departure = new Date(att.departureTime);
            const msRemaining = departure.getTime() - serverTime.getTime();
            
            const units = att.units || {};
            const isFake = att.isFake || false;

            let troopsStr = Object.entries(units)
                .map(([unit, count]) => `<img src="/graphic/unit/unit_${unit}.png" title="${unit}" style="width: 12px; height: 12px;"> ${count}`)
                .join('<br>');
            
            const villageName = att.villageName || 'Aldeia Desconhecida';
            const ownerName = att.ownerName || '???';
            const targetStr = `
                <strong>${villageName} (${att.targetX}|${att.targetY})</strong>
                <br>
                <span style="font-size: 9pt;">(Jogador: ${ownerName})</span>
            `;
                
            const departureStr = departure.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }) + '.' + String(departure.getMilliseconds()).padStart(3, '0');

            const $row = $('<tr>');
            
            let rowClass = '';
            if (isFake) {
                rowClass = 'planner-row-fake';
                troopsStr = '<strong style="color: #0080C0;">[FAKE]</strong><br>' + troopsStr;
            } else if (units.snob && units.snob > 0) {
                rowClass = 'planner-row-noble';
            } else {
                let totalUnits = 0;
                let otherUnitTypes = 0;
                Object.keys(units).forEach(unit => {
                    totalUnits += (units[unit] || 0);
                    if (unit !== 'spy') otherUnitTypes++;
                });
                if (otherUnitTypes === 0 && units.spy > 0) {
                    rowClass = 'planner-row-spy';
                } else if (totalUnits > 500) {
                    rowClass = 'planner-row-heavy';
                }
            }
            if (rowClass) $row.addClass(rowClass);

            $row.append(`<td>${targetStr}</td>`);
            $row.append(`<td style="font-size: 9pt;">${troopsStr}</td>`);
            $row.append(`<td>${departureStr}</td>`);
            $row.append(`<td><span class="attack-countdown" data-departure="${att.departureTime}">${formatTimeRemaining(msRemaining)}</span></td>`);
            
            const $actionCell = $('<td>');
            $actionCell.append(`<button class="btn delete-attack" data-id="${att.id}">X</button>`);
            $actionCell.append(`<button class="btn copy-attack" data-id="${att.id}" title="Copiar Ataque">Copiar</button>`);
            
            $row.append($actionCell);
            $table.append($row);
        });

        $list.append($table);
    }

    // --- 7. Inicialização ---

    $(document).ready(async function() {
        if (typeof game_data === 'undefined' || $('#command-data-form').length === 0) {
             console.log('[PLANEJADOR] Script não iniciado (fora da pág. de comando).');
             return;
        }
        
        injectPlannerUI(); 
        bindUIEvents();
        
        await initializeData(); 
        
        renderAttackList(); 
        
        setInterval(checkPlannedAttacks, 250);
    });

})();