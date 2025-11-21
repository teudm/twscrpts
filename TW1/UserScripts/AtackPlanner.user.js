// ==UserScript==
// @name         Command Planner
// @version      3.0
// @description  Planeje por horários de CHEGADA. Calcula tempo de viagem automaticamente baseado nas tropas e configurações do mundo.
// @author       TeudM
// @match        https://*.tribalwars.com.br/game.php?*screen=place*
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// @icon         https://www.google.com/s2/favicons?sz=64&domain=tribalwars.com.br
// @downloadURL https://raw.githubusercontent.com/teudm/twscrpts/main/TW1/UserScripts/AtackPlanner.user.js
// @updateURL   https://github.com/teudm/tribalwars/raw/main/TW1/UserScripts/AtackPlanner.user.js
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use-strict';

    // --- Globais ---
    const STORAGE_KEY_PREFIX = 'TW_AttackPlanner_POST_';
    const currentVillageID = game_data.village.id;
    const STORAGE_KEY = `${STORAGE_KEY_PREFIX}${currentVillageID}`;
    const MIN_ATTACK_INTERVAL_MS = 200;

    const VILLAGE_CACHE_KEY = 'TW_VILLAGE_DATA_CACHE';
    const PLAYER_CACHE_KEY = 'TW_PLAYER_DATA_CACHE';
    const WORLD_CONFIG_KEY = 'TW_WORLD_CONFIG_CACHE';
    const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

    let villageDataMap = new Map();
    let playerDataMap = new Map();
    let worldConfig = { speed: 1, unit_speed: 1 };
    let isDataFetching = false;
    
    let pendingTimers = {};
    let hasReloadedMidnight = false;

    const UNIT_PACE = {
        'spy': 9, 'light': 10, 'marcher': 10, 'knight': 10,
        'heavy': 11, 'spear': 18, 'axe': 18, 'archer': 18,
        'sword': 22, 'ram': 30, 'catapult': 30, 'snob': 35
    };

    GM_addStyle(`
        #plannedAttacksList .vis td, #plannedSupportsList .vis td { padding: 3px; border-bottom: 1px solid #F4E3BC; }
        #planner-container .vis th { padding: 3px; }
        .copy-attack { margin-left: 5px; }
        #planner-container td { padding: 4px; }
        
        .planner-row-fake td { background-color: rgba(0, 126, 143, 0.5) !important; }
        .planner-row-support td { background-color: rgba(0, 100, 200, 0.2) !important; }
        
        #planner-data-status {
            display: none; padding: 5px; text-align: center; 
            background-color: #fff3e0; border: 1px solid #825e2e; 
            color: #825e2e; font-weight: bold; margin-bottom: 10px; border-radius: 5px;
        }

        .planner-info-box {
            background-color: #f4e4bc; border: 1px solid #c1a264;
            padding: 6px; margin-bottom: 5px; font-size: 11px;
            display: flex; justify-content: space-between; align-items: center;
        }
        .planner-target-info {
            background-color: #fff5da; border: 1px solid #c1a264;
            padding: 6px; margin-bottom: 5px; font-size: 11px; color: #603000;
        }
        .planner-calc-result { font-weight: bold; color: #003f00; }
        .planner-calc-warning { color: #b30000; }
    `);

    // --- 1. Timer Loop ---
    function checkPlannedAttacks() {
        const serverTime = parseServerTime();
        if (!serverTime) return;

        // Meia-noite check
        const timeStr = $('#serverTime').text();
        if (timeStr.startsWith("00:00:0") && !hasReloadedMidnight) {
            hasReloadedMidnight = true; location.reload(); return;
        }
        if (!timeStr.startsWith("00:00:0")) hasReloadedMidnight = false;

        updateCountdowns(serverTime);

        const attacks = getAttacksFromStorage();
        const serverTimeMs = serverTime.getTime();

        for (const attack of attacks) {
            if (attack.originID !== currentVillageID) continue;
            if (pendingTimers[attack.id]) continue;

            // attack.departureTime já considera o offset salvo
            const dueTime = new Date(attack.departureTime).getTime();
            const msRemaining = dueTime - serverTimeMs;

            // Se passou do tempo (até 1s de atraso aceitável para disparo imediato)
            if (msRemaining < -1000) {
                console.log(`[PLANEJADOR] Atrasado. Disparando ${attack.id}.`);
                pendingTimers[attack.id] = true;
                triggerAttack(attack);
                break; 
            }

            // Se faltam menos de 20s, agenda o setTimeout preciso
            if (msRemaining > 0 && msRemaining < 20000) {
                const timerId = setTimeout(() => triggerAttack(attack), msRemaining);
                pendingTimers[attack.id] = timerId;
            }
        }
    }

    function triggerAttack(attack) { sendAttackPOST_Step1(attack); }

    // --- 2. Envio POST ---
    function sendAttackPOST_Step1(attack) {
        const $form = $('#command-data-form');
        if ($form.length === 0) { delete pendingTimers[attack.id]; return; }

        const postURL = $form.attr('action');
        let postData = {};
        $form.find('input[type=hidden]').each(function() { postData[$(this).attr('name')] = $(this).val(); });

        postData.x = attack.targetX;
        postData.y = attack.targetY;
        const allUnits = game_data.units.filter(u => u !== 'militia');
        allUnits.forEach(unit => { postData[unit] = attack.units[unit] || 0; });

        if (attack.commandType === 'support') postData.support = "Apoio"; else postData.attack = "Ataque"; 

        $.post(postURL, postData)
            .done(function(html) {
                if (typeof html === 'string' && html.includes('command-data-form')) sendAttackPOST_Step2(html, attack);
                else delete pendingTimers[attack.id];
            })
            .fail(function() { delete pendingTimers[attack.id]; });
    }

    function sendAttackPOST_Step2(html, originalAttack) {
        try {
            const $resp = $(html);
            const $form = $resp.find('#command-data-form');
            if ($form.length === 0) { delete pendingTimers[originalAttack.id]; return; }

            const url = $form.attr('action');
            let data = {};
            $form.find('input[type=hidden]').each(function() { data[$(this).attr('name')] = $(this).val(); });

            let $btn = originalAttack.commandType === 'support' ? 
                $form.find('input[type=submit][name="support"]') : $form.find('input[type=submit][name="attack"]');
            if (!$btn.length) $btn = $form.find('input[type=submit][name="submit"]');
            if ($btn.length) data[$btn.attr('name')] = $btn.val();

            $.post(url, data)
                .done(function(final) {
                    if (final.redirect || (typeof final === 'string' && final.includes('screen=overview"'))) {
                         removeAttackFromStorage(originalAttack.id);
                         renderAttackList(); 
                         delete pendingTimers[originalAttack.id];
                         checkSafeToReload(); 
                    } else delete pendingTimers[originalAttack.id];
                })
                .fail(function() { delete pendingTimers[originalAttack.id]; });

        } catch (e) { delete pendingTimers[originalAttack.id]; }
    }

    function checkSafeToReload() {
        const attacks = getAttacksFromStorage();
        if (!attacks.length) { setTimeout(() => location.reload(), 250); return; }
        const now = (parseServerTime() || new Date()).getTime();
        // Se não tem ataque nos próximos 10s, reload
        if (!attacks.some(att => !pendingTimers[att.id] && Math.abs(new Date(att.departureTime).getTime() - now) <= 10000)) {
             setTimeout(() => location.reload(), 250);
        }
    }

    // --- 3. Utils ---
    function parseServerTime() {
        try {
            const d = $('#serverDate').text().split('/');
            const t = $('#serverTime').text().split(':');
            return new Date(d[2], d[1]-1, d[0], t[0], t[1], t[2]);
        } catch (e) { return null; }
    }

    function updateCountdowns(serverTime) {
        const nowMs = serverTime.getTime();
        $('.attack-countdown').each(function() {
            const ms = new Date($(this).data('departure')).getTime() - nowMs;
            $(this).text(formatTimeRemaining(ms));
        });
    }

    function formatTimeRemaining(ms) {
        if (ms <= 0) return "Enviando...";
        let s = Math.floor(ms/1000);
        let m = Math.floor(s/60);
        let h = Math.floor(m/60);
        return `${h}:${String(m%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
    }

    // Math TW
    function calculateTravelTime(originX, originY, targetX, targetY, slowestUnit) {
        const dist = Math.sqrt(Math.pow(originX - targetX, 2) + Math.pow(originY - targetY, 2));
        const pace = UNIT_PACE[slowestUnit] || 18;
        const travelSec = Math.round(dist * pace * 60 / (worldConfig.speed * worldConfig.unit_speed));
        return { distance: dist.toFixed(2), durationMs: travelSec * 1000 };
    }

    function getSlowestUnit(units) {
        let slowest = null, maxPace = -1;
        for (const u in units) {
            if (units[u] > 0 && (UNIT_PACE[u] || 0) > maxPace) {
                maxPace = UNIT_PACE[u]; slowest = u;
            }
        }
        return slowest;
    }

    // --- 4. Storage & Data ---
    function getAttacksFromStorage() { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    function saveAttacksToStorage(data) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    function removeAttackFromStorage(id) { saveAttacksToStorage(getAttacksFromStorage().filter(a => a.id != id)); }

    async function initializeData() {
        // Config
        const cConf = JSON.parse(localStorage.getItem(WORLD_CONFIG_KEY) || '{}');
        if (cConf.timestamp && (Date.now() - cConf.timestamp < CACHE_DURATION_MS * 7)) worldConfig = cConf.data;
        else await fetchWorldConfig();

        // Map Data
        const cVill = JSON.parse(localStorage.getItem(VILLAGE_CACHE_KEY) || '{}');
        const cPlay = JSON.parse(localStorage.getItem(PLAYER_CACHE_KEY) || '{}');
        const now = Date.now();
        if (!cVill.timestamp || (now - cVill.timestamp > CACHE_DURATION_MS)) await fetchWorldData();
        else loadDataFromCache(cVill, cPlay);
    }

    async function fetchWorldConfig() {
        try {
            const r = await $.ajax({ url: '/interface.php?func=get_config', dataType: 'xml' });
            worldConfig = { speed: parseFloat($(r).find('speed').text()), unit_speed: parseFloat($(r).find('unit_speed').text()) };
            localStorage.setItem(WORLD_CONFIG_KEY, JSON.stringify({ timestamp: Date.now(), data: worldConfig }));
        } catch(e) {}
    }

    function loadDataFromCache(cV, cP) {
        try { villageDataMap = new Map(cV.data); playerDataMap = new Map(cP.data); } catch (e) { fetchWorldData(); }
    }

    async function fetchWorldData() {
        if (isDataFetching) return; isDataFetching = true;
        $('#planner-data-status').text('Baixando dados do mundo...').show();
        $('.btn-schedule').prop('disabled', true).val('Carregando...');
        try {
            const [vR, pR] = await Promise.all([fetch('/map/village.txt'), fetch('/map/player.txt')]);
            const vT = await vR.text(); const pT = await pR.text();

            villageDataMap.clear();
            vT.trim().split('\n').forEach(l => {
                // village.txt: id, name, x, y, player, points, rank
                const p = l.split(',');
                villageDataMap.set(`${p[2]},${p[3]}`, {
                    id: Number(p[0]), name: decodeURIComponent(p[1].replace(/\+/g, ' ')),
                    playerId: Number(p[4]), points: Number(p[5] || 0)
                });
            });
            playerDataMap.clear();
            pT.trim().split('\n').forEach(l => {
                const p = l.split(',');
                playerDataMap.set(Number(p[0]), { name: decodeURIComponent(p[1].replace(/\+/g, ' ')) });
            });
            playerDataMap.set(0, { name: 'Bárbaro' });

            localStorage.setItem(VILLAGE_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: Array.from(villageDataMap.entries()) }));
            localStorage.setItem(PLAYER_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: Array.from(playerDataMap.entries()) }));
        } catch (e) { $('#planner-data-status').text('Erro.').show(); }
        finally { 
            isDataFetching = false; 
            setTimeout(() => $('#planner-data-status').fadeOut(500), 2000);
            $('.btn-schedule').prop('disabled', false).val(function() { return $(this).attr('data-original-val'); });
        }
    }

    // --- 5. UI ---
    function injectPlannerUI() {
        const unitsInGame = game_data.units; 
        const buildUnitTable = (title, units) => {
            let rows = `<tr><th>${title}</th></tr>`;
            units.forEach(u => {
                if (unitsInGame.includes(u)) rows += `<tr><td class="nowrap"><a class="unit_link" data-unit="${u}"><img src="/graphic/unit/unit_${u}.png"></a> <input name="${u}" type="text" class="unit-input unitsInput"></td></tr>`;
            });
            return `<table class="vis" width="100%">${rows}</table>`;
        };

        const plannerHTML = `
            <div id="planner-container" style="margin-top: 20px;">
                <hr>
                <div id="planner-data-status"></div>
                <h3>Planejador v3.0</h3>
                <form id="addAttackPOSTForm">
                    <table class="vis" style="width: 100%;">
                        <tr>
                            <td width="150">Coordenadas:</td>
                            <td><input type="text" id="plannerCoords" placeholder="500|500" size="10" maxlength="7" /></td>
                        </tr>
                        <tr><td colspan="2"><div id="targetInfoDisplay" class="planner-target-info">Aguardando coordenadas...</div></td></tr>
                        <tr>
                            <td><strong>Hora da CHEGADA desejado:</strong></td>
                            <td>
                                <input type="datetime-local" id="plannerArrival" step="1" />
                                MS: <input type="number" id="plannerMS" size="3" min="0" max="999" value="0" />
                            </td>
                        </tr>
                        <tr>
                            <td>Offset (Lag):</td>
                            <td>
                                <input type="number" id="plannerOffset" size="4" value="0" placeholder="ms" /> ms
                                <span style="font-size: 9px; color: #555;">(Subtrai este valor do tempo de saída. Ex: 200 = envia 200ms antes)</span>
                            </td>
                        </tr>
                        <tr>
                             <td colspan="2">
                                <div class="planner-info-box">
                                    <span>Dist: <span id="calcDistance">--</span></span>
                                    <span>Lenta: <span id="calcSlowUnit">--</span></span>
                                    <span>Viagem: <span id="calcDuration" class="planner-calc-result">00:00:00</span></span>
                                </div>
                                <div class="planner-info-box" style="background-color: #e0f0ff; border-color: #8fa8c4;">
                                    <span><strong>Saída Real (Offset):</strong> <span id="calcDeparture" class="planner-calc-result">--</span></span>
                                </div>
                             </td>
                        </tr>
                        <tr>
                            <td>Opções:</td>
                            <td><label><input type="checkbox" id="plannerFake" /> Marcar como FAKE</label></td>
                        </tr>
                    </table>
                    <table style="width: 100%; margin-top: 5px;"><tbody><tr>
                        <td valign="top" style="width: 25%;">${buildUnitTable('Infantaria', ['spear', 'sword', 'axe', 'archer'])}</td>
                        <td valign="top" style="width: 25%;">${buildUnitTable('Cavalaria', ['spy', 'light', 'marcher', 'heavy'])}</td>
                        <td valign="top" style="width: 25%;">${buildUnitTable('Cerco', ['ram', 'catapult'])}</td>
                        <td valign="top" style="width: 25%;">${buildUnitTable('Outros', ['knight', 'snob'])}</td>
                    </tr></tbody></table>
                    <br>
                    <div style="display: flex; gap: 10px;">
                        <input type="button" class="btn btn-premium btn-schedule" id="btnScheduleAttack" data-original-val="Agendar Ataque" value="Agendar Ataque" />
                        <input type="button" class="btn btn-premium btn-schedule" id="btnScheduleSupport" data-original-val="Agendar Apoio" value="Agendar Apoio" />
                    </div>
                </form>
                <hr>
                <h3>Ataques Agendados</h3><div id="plannedAttacksList"></div>
                <br>
                <h3>Apoios Agendados</h3><div id="plannedSupportsList"></div>
            </div>
        `;
        
        const $tbody = $('#content_value').closest('table.main').find('tbody').first(); 
        if ($tbody.length) $tbody.append(`<tr><td id="planner_cell_container" style="padding: 10px;" colspan="100%">${plannerHTML}</td></tr>`);
        else $('#command-data-form').after(plannerHTML);
    }

    function bindUIEvents() {
        $('#btnScheduleAttack').on('click', () => handleAddCommand('attack'));
        $('#btnScheduleSupport').on('click', () => handleAddCommand('support'));
        
        $('#plannerCoords').on('input', function() {
            let val = $(this).val().replace(/\D/g, ''); 
            if (val.length > 6) val = val.substring(0, 6);
            if (val.length > 3) val = val.substring(0, 3) + '|' + val.substring(3);
            $(this).val(val);
            recalculateLogistics();
        });
        
        $('#plannerArrival, #plannerMS, #plannerOffset').on('change input', recalculateLogistics);
        $('.unit-input').on('change input', recalculateLogistics);
        $(document).on('click', '.delete-attack', handleDeleteAttack);
        $(document).on('click', '.copy-attack', handleCopyAttack);
    }

    let calculatedRealDeparture = null;

    function recalculateLogistics() {
        // Coords & Target Info
        const coordStr = $('#plannerCoords').val().trim();
        let villageInfo = null;

        if (coordStr.length >= 7 && coordStr.includes('|')) {
            const [tx, ty] = coordStr.split('|');
            villageInfo = villageDataMap.get(`${tx},${ty}`);
        }

        if (villageInfo) {
            const player = playerDataMap.get(villageInfo.playerId);
            const playerName = player ? player.name : "Desconhecido";
            const points = villageInfo.points ? villageInfo.points.toLocaleString('pt-BR') : "0";
            $('#targetInfoDisplay').html(`<strong>${villageInfo.name}</strong> (${coordStr})<br>Jogador: <a href="/game.php?screen=info_player&id=${villageInfo.playerId}">${playerName}</a>`);
        } else {
            $('#targetInfoDisplay').text(coordStr.length >= 3 ? 'Aldeia não encontrada...' : 'Aguardando coordenadas...');
        }

        // Calc
        if (!villageInfo) { resetCalcDisplay(); return; }
        
        const originX = game_data.village.x;
        const originY = game_data.village.y;
        const targetX = parseInt(coordStr.split('|')[0]);
        const targetY = parseInt(coordStr.split('|')[1]);

        const units = {};
        $('.unit-input').each(function() { if($(this).val()>0) units[$(this).attr('name')] = parseInt($(this).val()); });
        
        const slowest = getSlowestUnit(units);
        if (!slowest) { resetCalcDisplay(); return; }

        const result = calculateTravelTime(originX, originY, targetX, targetY, slowest);
        $('#calcDistance').text(result.distance);
        $('#calcSlowUnit').html(`<img src="/graphic/unit/unit_${slowest}.png" />`);
        $('#calcDuration').text(formatDuration(result.durationMs));

        const arrivalVal = $('#plannerArrival').val();
        if (arrivalVal) {
            const arr = new Date(arrivalVal);
            arr.setMilliseconds(parseInt($('#plannerMS').val() || 0));
            
            // Saída Matemática
            const mathDep = arr.getTime() - result.durationMs;
            
            // Aplica Offset
            const offset = parseInt($('#plannerOffset').val() || 0);
            const realDep = new Date(mathDep - offset);
            
            calculatedRealDeparture = realDep;
            
            const str = realDep.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }) + '.' + String(realDep.getMilliseconds()).padStart(3, '0');
            $('#calcDeparture').text(`${str} (Offset: -${offset}ms)`);
            
            if (realDep < (parseServerTime() || new Date())) $('#calcDeparture').addClass('planner-calc-warning');
            else $('#calcDeparture').removeClass('planner-calc-warning');

        } else {
            $('#calcDeparture').text('--');
            calculatedRealDeparture = null;
        }
    }

    function resetCalcDisplay() {
        $('#calcDistance').text('--'); $('#calcSlowUnit').text('--');
        $('#calcDuration').text('00:00:00'); $('#calcDeparture').text('--');
    }
    
    function formatDuration(ms) {
        let s = Math.floor(ms/1000), m = Math.floor(s/60), h = Math.floor(m/60);
        return `${h}:${String(m%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
    }

    function handleAddCommand(type) {
        recalculateLogistics();
        if (!calculatedRealDeparture) { alert('Dados incompletos.'); return; }
        if (calculatedRealDeparture <= (parseServerTime() || new Date())) { alert('Horário já passou.'); return; }

        const coordStr = $('#plannerCoords').val().trim();
        const [tx, ty] = coordStr.split('|');
        const villageInfo = villageDataMap.get(`${tx},${ty}`);
        
        const units = {};
        $('.unit-input').each(function() { if($(this).val()>0) units[$(this).attr('name')] = parseInt($(this).val()); });

        // Ajuste de Colisão (200ms)
        let depDate = new Date(calculatedRealDeparture);
        const attacks = getAttacksFromStorage();
        const existing = attacks.filter(a => a.targetX == tx && a.targetY == ty && a.commandType === type);
        if (existing.length) {
            const max = Math.max(...existing.map(a => new Date(a.departureTime).getTime()));
            if (depDate.getTime() >= max && depDate.getTime() < (max + MIN_ATTACK_INTERVAL_MS)) {
                depDate.setTime(max + MIN_ATTACK_INTERVAL_MS);
                alert('Ajuste colisão (+200ms).');
            }
        }

        const newAtt = {
            id: Date.now(),
            originID: currentVillageID,
            departureTime: depDate.toISOString(),
            targetX: tx, targetY: ty, units: units,
            isFake: $('#plannerFake').is(':checked'),
            villageName: villageInfo ? villageInfo.name : 'Desconhecido',
            ownerName: villageInfo ? (playerDataMap.get(villageInfo.playerId)?.name || '?') : '?',
            commandType: type,
            offsetUsed: parseInt($('#plannerOffset').val() || 0) // Salva o offset usado pra referencia futura se precisar
        };

        attacks.push(newAtt);
        attacks.sort((a, b) => new Date(a.departureTime) - new Date(b.departureTime));
        saveAttacksToStorage(attacks);
        renderAttackList();
        
        $('#plannerCoords').val(''); $('#plannerArrival').val(''); $('#plannerMS').val('0');
        $('.unit-input').val(''); $('#targetInfoDisplay').text('Aguardando coordenadas...'); resetCalcDisplay();
    }

    function handleDeleteAttack() { removeAttackFromStorage($(this).data('id')); renderAttackList(); }
    
    function handleCopyAttack() {
        const a = getAttacksFromStorage().find(x => x.id == $(this).data('id'));
        if(!a) return;
        $('#plannerCoords').val(`${a.targetX}|${a.targetY}`);
        $('#addAttackPOSTForm .unit-input').val('');
        for(const u in a.units) $(`#addAttackPOSTForm .unit-input[name="${u}"]`).val(a.units[u]);
        $('#plannerFake').prop('checked', a.isFake||false);
        if(a.offsetUsed) $('#plannerOffset').val(a.offsetUsed); // Recupera o offset usado naquele ataque
        recalculateLogistics();
        document.getElementById('planner-container').scrollIntoView({behavior:'smooth'});
    }

    function renderAttackList() {
        const atts = getAttacksFromStorage();
        const render = (list, id, label) => {
            const $el = $(id).empty();
            if(!list.length) { $el.html(`<p>Nenhum ${label}.</p>`); return; }
            const $tbl = $('<table class="vis" width="100%"><tr><th>Alvo</th><th>Tropas</th><th>Saída (Real)</th><th>Chegada (Est.)</th><th>Timer</th><th>Ação</th></tr></table>');
            const now = (parseServerTime() || new Date()).getTime();
            
            list.forEach(a => {
                const dep = new Date(a.departureTime);
                const units = a.units || {};
                const slowest = getSlowestUnit(units);
                let arrStr = "---";
                if(slowest) {
                    // Recalcula chegada para mostrar (baseada na saida real + offset reverso + viagem)
                    // Simples: Saída Real + Tempo Viagem
                    const res = calculateTravelTime(game_data.village.x, game_data.village.y, a.targetX, a.targetY, slowest);
                    arrStr = new Date(dep.getTime() + res.durationMs).toLocaleString('pt-BR', {timeStyle:'medium'});
                }

                let info = `<strong>${a.villageName} (${a.targetX}|${a.targetY})</strong><br><span style="font-size:9px;">${a.ownerName}</span>`;
                let troops = Object.entries(units).map(([u,c]) => `<img src="/graphic/unit/unit_${u}.png" width="12"> ${c}`).join(' ');
                let depStr = dep.toLocaleString('pt-BR', {timeStyle:'medium'}) + '.' + String(dep.getMilliseconds()).padStart(3,'0');
                
                const $tr = $('<tr>');
                if(a.isFake) { $tr.addClass('planner-row-fake'); troops = '<b style="color:#0080C0;">[FAKE]</b> '+troops; }
                else if(a.commandType === 'support') $tr.addClass('planner-row-support');

                $tr.append(`<td>${info}</td><td>${troops}</td><td>${depStr}</td><td>${arrStr}</td><td><span class="attack-countdown" data-departure="${a.departureTime}">${formatTimeRemaining(dep.getTime()-now)}</span></td>`);
                $tr.append(`<td><button class="btn delete-attack" data-id="${a.id}">X</button> <button class="btn copy-attack" data-id="${a.id}">Copy</button></td>`);
                $tbl.append($tr);
            });
            $el.append($tbl);
        };
        render(atts.filter(a => !a.commandType || a.commandType === 'attack'), '#plannedAttacksList', 'ataque');
        render(atts.filter(a => a.commandType === 'support'), '#plannedSupportsList', 'apoio');
    }

    // --- Init ---
    $(document).ready(async function() {
        // Trava URL
        const mode = new URLSearchParams(window.location.search).get('mode');
        if (mode && mode !== 'command') return;
        if (typeof game_data === 'undefined' || !$('#command-data-form').length) return;

        injectPlannerUI(); bindUIEvents();
        await initializeData(); 
        renderAttackList(); setInterval(checkPlannedAttacks, 250);
    });
})();