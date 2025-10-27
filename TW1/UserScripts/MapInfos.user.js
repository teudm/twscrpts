// ==UserScript==
// @name         Scanner de vizinhança
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Escanear a vizinhança no tribal wars
// @author       teudm
// @match        https://*.tribalwars.com.br/*screen=map*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=tribalwars.com.br
// @downloadURL  https://raw.githubusercontent.com/teudm/twscrpts/main/TW1/UserScripts/MapInfos.user.js
// @updateURL    https://github.com/teudm/twscrpts/TW1/raw/main/UserScripts/MapInfos.user.js
// ==/UserScript==

(function () {
    'use strict';

    function runScript() {
        const STORAGE_KEY = "scannerVizinhosData_v3";
        const HISTORY_LIMIT = 10;

        const STAGNANT_THRESHOLD_MS = 24 * 60 * 60 * 1000;
        const INACTIVE_THRESHOLD_MS = 72 * 60 * 60 * 1000;

        const UNIT_BASE_SPEEDS = {
            spear: 18, sword: 22, axe: 18, spy: 9, light: 10,
            heavy: 11, ram: 29, catapult: 29, knight: 10, snob: 35
        };
        const STATIC_IMAGE_BASE_URL = "https://dsbr.innogamescdn.com/asset/caf5a096/graphic/unit/recruit/";

        function getGameData() { return game_data || {}; }
        function getTWMapVillages() { return TWMap && TWMap.villages ? TWMap.villages : null; }
        function getPlayers() { return TWMap && TWMap.players ? TWMap.players : {}; }
        function getAllies() { return TWMap && TWMap.allies ? TWMap.allies : {}; }

        function extrairCoordenadas(v) {
            if (v.x === undefined || v.y === undefined) {
                const xy = v.xy || v.XY || v.coords || 0;
                const n = Number(xy) || 0;
                v.x = Math.floor(n / 1000);
                v.y = n % 1000;
            }
            return v;
        }

        function distancia(v1, v2) {
            if (v1.x === undefined || v1.y === undefined) v1 = extrairCoordenadas(v1);
            if (v2.x === undefined || v2.y === undefined) v2 = extrairCoordenadas(v2);
            return Math.sqrt(Math.pow(v1.x - v2.x, 2) + Math.pow(v1.y - v2.y, 2));
        }

        function safeParseInt(str) {
            if (!str) return 0;
            return parseInt(String(str).replace(/[.,]/g, ''), 10) || 0;
        }

        function formatarTempo(minutos) {
            if (minutos < 0 || !isFinite(minutos)) return "N/A";
            const h = Math.floor(minutos / 60);
            const m = Math.floor(minutos % 60);
            const s = Math.floor((minutos * 60) % 60);
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }

        function toggleGraph(event) {
            const btn = event.target;
            const container = document.getElementById(btn.dataset.graphId);
            if (!container) return;
            const isShowing = container.style.display !== 'none';
            container.style.display = isShowing ? 'none' : 'block';
            btn.textContent = btn.textContent.replace(isShowing ? "Ocultar" : "Mostrar", isShowing ? "Mostrar" : "Ocultar");
            if (!isShowing) {
                container.querySelectorAll('img[data-src]').forEach(img => {
                    if (!img.src) img.src = img.dataset.src;
                });
            }
        }

        function toggleBonus(event) {
            event.preventDefault();
            const desc = document.getElementById(event.target.dataset.bonusId);
            if (desc) desc.style.display = desc.style.display === 'block' ? 'none' : 'block';
        }

        function createGraphLabel(text) {
            const label = document.createElement('small');
            label.style.cssText = 'display: block; font-weight: bold; margin-top: 6px;';
            label.textContent = text;
            return label;
        }

        function createGraphImage(srcUrl, alt) {
            const img = document.createElement('img');
            img.dataset.src = srcUrl;
            img.style.cssText = 'width: 100%; max-width: 500px;';
            img.alt = alt;
            img.onerror = () => { if(img.parentElement) img.parentElement.textContent = 'Erro ao carregar gráfico.'; };
            return img;
        }

        const gameData = getGameData();
        const hasFarmAssistant = gameData.features?.FarmAssistent?.active === true;
        
        const minhaAldeia = gameData.village;
        const meuPlayerId = gameData.player.id.toString();
        const minhaTriboId = safeParseInt(gameData.player.ally);
        const todasVilas = getTWMapVillages();
        const players = getPlayers();
        const tribos = getAllies();

        const old = document.getElementById("scannerVizinhos");
        if (old) old.remove();

        const container = document.createElement("div");
        container.id = "scannerVizinhos";
        container.style.cssText = "background: #f9f9f9; border: 1px solid #bbb; margin-top: 10px; padding: 8px; font-size: 13px;";

        const header = document.createElement("div");
        header.style.cssText = "display: flex; gap: 8px; align-items: center; flex-wrap: wrap;";
        header.innerHTML = `<b>Scanner de aldeias próximas</b>`;
        const btnToggleGraphsGlobal = document.createElement("button");
        btnToggleGraphsGlobal.textContent = "Mostrar/Ocultar todos gráficos";
        header.appendChild(btnToggleGraphsGlobal);
        container.appendChild(header);

        const filtrosDiv = document.createElement("div");
        filtrosDiv.style.cssText = "margin-top: 8px; padding: 5px; border: 1px solid #eee; background-color: #fafafa; display: flex; flex-wrap: wrap; gap: 5px; align-items: center;";
        filtrosDiv.innerHTML = `
            <b>Filtros:</b>
            <button id="filtroTodas">Mostrar todas</button>
            <button id="filtroBarbaras">Apenas bárbaras</button>
            <button id="filtroPlayers">Apenas players</button>
            <button id="filtroInativos">Apenas inativos</button>
            <span style="border-left: 1px solid #ccc; margin: 0 5px; height: 20px;"></span>
            <input type="text" id="filtroPontosMin" placeholder="Pontos mín." style="width: 80px; font-size: 11px; padding: 2px;">
            <button id="btnFiltroPontos">Filtrar Bárbaras/Inativas</button>
        `;
        container.appendChild(filtrosDiv);

        const buscaDiv = document.createElement("div");
        buscaDiv.style.cssText = "margin-top: 8px; padding: 5px; border: 1px solid #eee; background-color: #fafafa;";
        buscaDiv.innerHTML = `
            <label for="searchTableInput" style="margin-right: 5px;"><b>Buscar na tabela:</b></label>
            <input type="search" id="searchTableInput" placeholder="Nome, Jogador ou Tribo..." style="width: 200px; font-size: 11px; padding: 2px;">
        `;
        container.appendChild(buscaDiv);

        const tribeSummaryDiv = document.createElement("div");
        tribeSummaryDiv.id = "tribeSummary";
        tribeSummaryDiv.style.cssText = "margin-top: 8px; padding: 8px; border: 1px solid #eee; background-color: #fafafa;";
        tribeSummaryDiv.innerHTML = '<b>Resumo das Tribos Próximas:</b><div style="max-height: 150px; overflow-y: auto; margin-top: 5px;">Carregando...</div>';
        container.appendChild(tribeSummaryDiv);

        if (!hasFarmAssistant) {
            const avisoFADiv = document.createElement("div");
            avisoFADiv.style.cssText = "margin-top: 8px; padding: 8px; border: 1px solid #e6a800; background-color: #fff9c4; color: #7f6000; font-weight: bold; text-align: center;";
            avisoFADiv.textContent = "Ative o Assistente de Saque para ter acesso aos botões de ataque rápido (A/B).";
            container.appendChild(avisoFADiv);
        }

        const tabelaWrapper = document.createElement("div");
        tabelaWrapper.style.cssText = "max-height: 600px; overflow-y: auto; margin-top: 8px; border-top: 1px solid #ccc; border-bottom: 1px solid #ccc;";
        const tabela = document.createElement("table");
        tabela.style.cssText = "width: 100%; border-collapse: collapse;";
        const stickyStylesBase = "padding:4px; border:1px solid #ddd; position: sticky; top: 0; background: #eee; z-index: 1;";
        tabela.innerHTML = `
            <thead>
                <tr>
                    <th style="${stickyStylesBase} width: 150px;">Aldeia</th>
                    <th style="${stickyStylesBase} width: 90px;">Pontos (Aldeia)</th>
                    <th style="${stickyStylesBase} width: 150px;">Proprietário</th>
                    <th style="${stickyStylesBase}">Tribo</th>
                    <th style="${stickyStylesBase}">Distância</th>
                    <th style="${stickyStylesBase}">Status</th>
                    <th style="${stickyStylesBase}">Ação</th>
                    <th style="${stickyStylesBase} width: 130px;">Tempo de Chegada</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        tabelaWrapper.appendChild(tabela);
        container.appendChild(tabelaWrapper);

        const target = document.querySelector("#content_value") || document.body;
        target.appendChild(container);

        function loadOld() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; } }
        function saveNew(obj) { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); }
        function sendFarmRequest(event) {
            const btn = event.target;
            const targetId = btn.dataset.targetId;
            const template = btn.textContent.toLowerCase();
            const urlKey = `mp_farm_${template}`;

            if (!targetId || !TWMap.urls.ctx[urlKey]) {
                console.error("Scanner Vizinhança: Erro no ataque rápido.", { targetId, urlKey });
                if (typeof UI !== 'undefined') UI.InfoMessage("Erro ao enviar ataque rápido.", 2000, "error");
                return;
            }

            btn.disabled = true;
            btn.textContent = "...";

            const url = TWMap.urls.ctx[urlKey]
                .replace(/__village__/, targetId)
                .replace(/__source__/, minhaAldeia.id);

            TribalWars.get(url, null, function (response) {
                TWMap.context.ajaxDone(null, url);
                console.log(`Ataque rápido (${template}) enviado para ${targetId}`, response);
                
                btn.textContent = "\u2713";
                btn.style.backgroundColor = "#d4edda";
                btn.style.color = "#155724";
                btn.style.opacity = "1.0";
                setTimeout(() => {
                    btn.disabled = false;
                    btn.textContent = template.toUpperCase();
                    btn.style.backgroundColor = "#6f4e37";
                    btn.style.color = "white";
                    btn.style.opacity = btn.dataset.originalOpacity || "1.0"; 
                }, 1500);

            }, function () {
                console.error(`Scanner Vizinhança: Falha ao enviar ataque rápido (${template}) para ${targetId}`);
                if (typeof UI !== 'undefined') UI.InfoMessage("Falha ao enviar ataque rápido.", 2000, "error");                
                btn.disabled = false;
                btn.textContent = template.toUpperCase();
                btn.style.opacity = btn.dataset.originalOpacity || "1.0"; 
            }, undefined);
        }

        function rebuild() {
            const arrV = Object.values(todasVilas)
                .map(v => extrairCoordenadas({ ...v }))
                .map(v => ({ ...v, dist: distancia(minhaAldeia, v) }))
                .sort((a, b) => a.dist - b.dist);

            const tbody = tabela.querySelector("tbody");
            tbody.innerHTML = "";
            const oldData = loadOld();
            const newDataToSave = {};
            const serverDomain = gameData.market;
            const worldId = gameData.world;
            const now = Date.now();
            const tribeDataSummary = {};

            arrV.forEach(v => {
                const player = players[v.owner];
                const playerId = player ? v.owner.toString() : null;
                const isOwner = playerId === meuPlayerId;
                const ownerName = player ? player.name : "Bárbara";
                const pontosJogador = player ? safeParseInt(player.points) : 0;
                const pontosVila = safeParseInt(v.points);
                const nomeAldeia = v.name || `${v.x}|${v.y}`;
                const coordsAldeia = `${v.x}|${v.y}`;
                const triboId = player ? safeParseInt(player.ally) : null;
                const triboData = triboId ? tribos[triboId] : null;
                const triboName = triboData ? (triboData.name || "—") : "—";
                const triboPoints = triboData ? safeParseInt(triboData.points) : 0;
                const isAlly = minhaTriboId && triboId && minhaTriboId === triboId;
                const bonusData = (!playerId && v.bonus_id != "0" && v.bonus) ? v.bonus[0] : null;

                const villageStorageKey = `v_${coordsAldeia}`;
                const prevVillageData = oldData[villageStorageKey] || { history: [] };
                const oldVillageHistory = prevVillageData.history;
                let entryForVillageDiff = null;
                let pontosVilaDiff = 0;
                const stagnantVillageTime = now - STAGNANT_THRESHOLD_MS;
                const villageEntry24h = oldVillageHistory.slice().reverse().find(entry => entry.ts < stagnantVillageTime);
                if (villageEntry24h) { entryForVillageDiff = villageEntry24h; }
                else if (oldVillageHistory.length > 0) { entryForVillageDiff = oldVillageHistory[0]; }
                if (entryForVillageDiff) { pontosVilaDiff = pontosVila - entryForVillageDiff.p; }
                let newVillageHistory = [...oldVillageHistory, { ts: now, p: pontosVila }];
                newDataToSave[villageStorageKey] = { history: newVillageHistory.slice(-HISTORY_LIMIT) };

                let status = "N/A";
                if (playerId) {
                    if (isOwner) {
                        status = "Própria";
                    } else {
                        const prevData = oldData[playerId] || { history: [] };
                        const oldHistory = prevData.history;

                        if (oldHistory.length <= 1) {
                            status = "Desconhecido";
                        } else {
                            const stagnantTime = now - STAGNANT_THRESHOLD_MS;
                            const inactiveTime = now - INACTIVE_THRESHOLD_MS;
                            const stagnantEntry = oldHistory.slice().reverse().find(e => e.ts < stagnantTime);
                            const inactiveEntry = oldHistory.slice().reverse().find(e => e.ts < inactiveTime);
                            
                            const oldestEntry = oldHistory[0]; 

                            if (inactiveEntry && pontosJogador <= inactiveEntry.p) {
                                status = "Possivelmente inativo (72h)";
                            } else if (stagnantEntry && pontosJogador === stagnantEntry.p) {
                                status = "Estagnado";
                            } else if ((stagnantEntry && pontosJogador > stagnantEntry.p) || (!stagnantEntry && pontosJogador > oldestEntry.p)) {
                                status = "Ativo";
                            } else {
                                status = "Em análise";
                            }
                        }
                        let newHistory = [...oldHistory, { ts: now, p: pontosJogador }];
                        newDataToSave[playerId] = { history: newHistory.slice(-HISTORY_LIMIT) };
                    }
                }

                if (triboId && !isOwner) {
                    if (!tribeDataSummary[triboId]) {
                        tribeDataSummary[triboId] = {
                            id: triboId, name: triboName, points: triboPoints,
                            players: new Set(), villageCount: 0
                        };
                    }
                    if (playerId) tribeDataSummary[triboId].players.add(playerId);
                    tribeDataSummary[triboId].villageCount++;
                }

                const tr = document.createElement("tr");
                tr.dataset.tipo = playerId ? "player" : "barbara";
                tr.dataset.pontosVila = pontosVila;
                tr.dataset.status = status;

                if (isOwner) tr.style.backgroundColor = '#f3e5f5';
                else if (bonusData) tr.style.backgroundColor = '#fff9c4';
                else if (isAlly) tr.style.backgroundColor = "#e3f2fd";
                else if (!playerId) tr.style.backgroundColor = "#f0f0f0";
                else if (status === "Possivelmente inativo (72h)") tr.style.backgroundColor = "#ffebee";
                else if (status === "Estagnado") tr.style.backgroundColor = "#fff3e0";
                else if (status === "Ativo") tr.style.backgroundColor = "#e8f5e9";

                const tdAldeia = document.createElement("td");
                tdAldeia.style.cssText = "padding: 4px; border: 1px solid #ddd;";
                const nomeSpan = document.createElement('span');
                nomeSpan.style.display = 'block';
                nomeSpan.textContent = isOwner ? '\u2B50 ' + nomeAldeia : nomeAldeia;
                tdAldeia.appendChild(nomeSpan);
                const coordsLink = document.createElement('a');
                coordsLink.href = `/game.php?screen=info_village&id=${v.id}`;
                coordsLink.textContent = `(${coordsAldeia})`;
                coordsLink.style.cssText = "display: block; text-decoration: underline; color: #007bff; font-size: 11px;";
                tdAldeia.appendChild(coordsLink);
                if (bonusData) {
                    const bonusToggle = document.createElement('a');
                    bonusToggle.href = '#';
                    bonusToggle.textContent = ' [Bônus]';
                    bonusToggle.style.cssText = "color: #e65100; font-weight: bold; text-decoration: none;";
                    bonusToggle.dataset.bonusId = 'bonus_desc_' + v.id;
                    bonusToggle.onclick = toggleBonus;
                    nomeSpan.appendChild(bonusToggle);
                    const bonusDesc = document.createElement('div');
                    bonusDesc.id = bonusToggle.dataset.bonusId;
                    bonusDesc.textContent = bonusData;
                    bonusDesc.style.cssText = "display: none; font-size: 11px; color: #333; margin-top: 4px; padding: 3px; background-color: #fff; border: 1px solid #ccc;";
                    tdAldeia.appendChild(bonusDesc);
                }

                const tdPontosVila = document.createElement("td");
                tdPontosVila.style.cssText = "padding: 4px; border: 1px solid #ddd;";
                const pontosVilaSpan = document.createElement('span');
                pontosVilaSpan.textContent = pontosVila.toLocaleString('pt-BR');
                tdPontosVila.appendChild(pontosVilaSpan);
                if (entryForVillageDiff) {
                    const diffSpan = document.createElement('span');
                    diffSpan.style.cssText = "display: block; font-size: 10px;";
                    if (pontosVilaDiff > 0) { diffSpan.textContent = `(+${pontosVilaDiff.toLocaleString('pt-BR')})`; diffSpan.style.color = 'green'; }
                    else if (pontosVilaDiff < 0) { diffSpan.textContent = `(${pontosVilaDiff.toLocaleString('pt-BR')})`; diffSpan.style.color = 'red'; }
                    else { diffSpan.textContent = `(=0)`; diffSpan.style.color = 'gray'; }
                    tdPontosVila.appendChild(diffSpan);
                }

                const tdProprietario = document.createElement("td");
                tdProprietario.style.cssText = "padding: 4px; border: 1px solid #ddd;";
                if (playerId) {
                    const link = document.createElement("a");
                    link.href = `/game.php?screen=info_player&id=${playerId}`;
                    link.textContent = ownerName;
                    if (isOwner) { link.style.fontWeight = 'bold'; link.style.color = '#6a1b9a'; }
                    tdProprietario.appendChild(link);
                    const pontosPlayerSpan = document.createElement("span");
                    pontosPlayerSpan.style.cssText = "margin-left: 4px; font-size: 11px; color: #555;";
                    pontosPlayerSpan.textContent = `(${pontosJogador.toLocaleString('pt-BR')})`;
                    tdProprietario.appendChild(pontosPlayerSpan);

                    const btnGraph = document.createElement("button");
                    btnGraph.textContent = "Mostrar Gráficos";
                    btnGraph.style.cssText = "display: block; margin-top: 4px; font-size: 11px;";
                    btnGraph.onclick = toggleGraph;
                    const graphContainerPlayer = document.createElement('div');
                    graphContainerPlayer.id = 'graph_cont_p_' + playerId + '_' + v.id;
                    graphContainerPlayer.style.display = 'none';
                    btnGraph.dataset.graphId = graphContainerPlayer.id;
                    const graphUrlPlayerP = `https://${serverDomain}.twstats.com/image.php?type=playergraph&id=${playerId}&s=${worldId}&graph=points`;
                    graphContainerPlayer.appendChild(createGraphLabel('Pontos:'));
                    graphContainerPlayer.appendChild(createGraphImage(graphUrlPlayerP, `Gráfico Pontos ${ownerName}`));
                    const graphUrlPlayerODA = `https://${serverDomain}.twstats.com/image.php?type=playergraph&id=${playerId}&s=${worldId}&graph=oda`;
                    graphContainerPlayer.appendChild(createGraphLabel('ODA (Ataque):'));
                    graphContainerPlayer.appendChild(createGraphImage(graphUrlPlayerODA, `Gráfico ODA ${ownerName}`));
                    const graphUrlPlayerODD = `https://${serverDomain}.twstats.com/image.php?type=playergraph&id=${playerId}&s=${worldId}&graph=odd`;
                    graphContainerPlayer.appendChild(createGraphLabel('ODD (Defesa):'));
                    graphContainerPlayer.appendChild(createGraphImage(graphUrlPlayerODD, `Gráfico ODD ${ownerName}`));
                    tdProprietario.appendChild(btnGraph);
                    tdProprietario.appendChild(graphContainerPlayer);

                } else { tdProprietario.textContent = "Bárbara"; }

                const tdTribe = document.createElement("td");
                tdTribe.style.cssText = "padding: 4px; border: 1px solid #ddd;";
                if (triboId && triboData) {
                    const linkTribe = document.createElement("a");
                    linkTribe.href = `/game.php?screen=info_ally&id=${triboId}`;
                    linkTribe.textContent = triboName;
                    tdTribe.appendChild(linkTribe);
                    const tribeInfoSpan = document.createElement("span");
                    tribeInfoSpan.style.cssText = "display: block; font-size: 11px; color: #555;";
                    let infoText = "";
                    if (triboPoints > 0) { infoText = `Pontos: ${triboPoints.toLocaleString('pt-BR')}`; }
                    if (infoText) { tribeInfoSpan.textContent = `(${infoText})`; tdTribe.appendChild(tribeInfoSpan); }
                } else { tdTribe.textContent = triboName; }

                const tdDist = document.createElement("td");
                tdDist.style.cssText = "padding: 4px; border: 1px solid #ddd;";
                tdDist.textContent = v.dist.toFixed(2);

                const tdStatus = document.createElement("td");
                tdStatus.style.cssText = "padding: 4px; border: 1px solid #ddd;";
                tdStatus.textContent = status;
                if (status === "Ativo") tdStatus.style.color = "green";
                else if (status === "Possivelmente inativo (72h)") tdStatus.style.color = "red";
                else if (status === "Estagnado") tdStatus.style.color = "orange";
                else if (status === "Própria") { tdStatus.style.color = '#6a1b9a'; tdStatus.style.fontWeight = 'bold'; }
                else tdStatus.style.color = "gray";

                const tdAction = document.createElement("td");
                tdAction.style.cssText = "padding: 4px; border: 1px solid #ddd; vertical-align: middle;";
                const actionContainer = document.createElement('div');
                actionContainer.style.cssText = "display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;";
                tdAction.appendChild(actionContainer);
                if (isOwner) {
                    tdAction.textContent = "---";
                    tdAction.style.textAlign = 'center';
                } else {
                    const btnBaseStyle = "padding: 3px 6px; border: 1px solid #aaa; border-radius: 3px; text-decoration: none; font-size: 11px; cursor: pointer; text-align: center; display: inline-block; min-width: 70px;";
                    const linkAttack = document.createElement("a");
                    linkAttack.href = `/game.php?village=${minhaAldeia.id}&screen=place&target=${v.id}`;
                    linkAttack.textContent = "Atacar/Apoiar";
                    if (!playerId || status === "Estagnado" || status === "Possivelmente inativo (72h)") {
                        linkAttack.style.cssText = btnBaseStyle + "background-color: #ffebee; color: #b71c1c; border-color: #e57373; font-weight: bold;";
                    } else {
                        linkAttack.style.cssText = btnBaseStyle + "background-color: #f5f5f5; color: #555; border-color: #ccc;";
                    }
                    actionContainer.appendChild(linkAttack);
                    const linkCentralize = document.createElement("a");
                    linkCentralize.href = `/game.php?screen=map&x=${v.x}&y=${v.y}`;
                    linkCentralize.textContent = "Centralizar";
                    linkCentralize.style.cssText = btnBaseStyle + "background-color: #e3f2fd; color: #0d47a1; border-color: #90caf9;";
                    actionContainer.appendChild(linkCentralize);
                    if (hasFarmAssistant && !isAlly) {                        
                        const farmLabel = document.createElement('small');
                        farmLabel.textContent = "Ataque Rápido (AS):";
                        farmLabel.style.cssText = "display: block; font-size: 10px; color: #666; margin-top: 5px; text-align: center;";
                        actionContainer.appendChild(farmLabel);
                        const quickFarmContainer = document.createElement('div');
                        quickFarmContainer.style.cssText = "display: flex; gap: 4px;";
                        let farmBtnStyle = btnBaseStyle.replace("display: inline-block;", "").replace("min-width: 70px;", "") +
                                            "background-color: #6f4e37; color: white; border-color: #5a3f2d; font-weight: bold; min-width: 30px; padding: 3px; transition: opacity 0.2s ease;";
                        let originalOpacity = "1.0";
                        if (status === "Ativo") {
                            originalOpacity = "0.35";
                            farmBtnStyle += ` opacity: ${originalOpacity};`;
                        }

                        // Botão A
                        const btnFarmA = document.createElement("button");
                        btnFarmA.textContent = "A";
                        btnFarmA.title = "Enviar modelo A (Assistente de Saque)";
                        btnFarmA.style.cssText = farmBtnStyle;
                        btnFarmA.dataset.targetId = v.id;
                        btnFarmA.dataset.originalOpacity = originalOpacity;
                        btnFarmA.onclick = sendFarmRequest;

                        // Botão B
                        const btnFarmB = document.createElement("button");
                        btnFarmB.textContent = "B";
                        btnFarmB.title = "Enviar modelo B (Assistente de Saque)";
                        btnFarmB.style.cssText = farmBtnStyle;
                        btnFarmB.dataset.targetId = v.id;
                        btnFarmB.dataset.originalOpacity = originalOpacity;
                        btnFarmB.onclick = sendFarmRequest;

                        quickFarmContainer.appendChild(btnFarmA);
                        quickFarmContainer.appendChild(btnFarmB);
                        actionContainer.appendChild(quickFarmContainer);
                    }
                }

                if (isAlly && !isOwner) {
                    tdAldeia.style.fontWeight = 'bold'; tdAldeia.style.color = '#1b5e20';
                    tdTribe.style.fontWeight = 'bold'; tdTribe.style.color = '#1b5e20';
                    Array.from(tdTribe.children).forEach(child => { child.style.fontWeight = 'bold'; child.style.color = '#1b5e20'; });
                }

                const tdTempos = document.createElement("td");
                tdTempos.style.cssText = "padding: 4px; border: 1px solid #ddd; font-size: 11px;";
                const dist = v.dist;
                if (dist === 0) {
                    tdTempos.textContent = "---";
                    tdTempos.style.textAlign = 'center';
                } else {
                    for (const unitName in UNIT_BASE_SPEEDS) {
                        const baseSpeed = UNIT_BASE_SPEEDS[unitName];
                        const tempoMinutos = dist * baseSpeed;
                        const tempoFormatado = formatarTempo(tempoMinutos);
                        const spriteUrl = `${STATIC_IMAGE_BASE_URL}${unitName}.webp`;
                        const lineDiv = document.createElement('div'); lineDiv.style.cssText = "display: flex; align-items: center; gap: 4px; margin-bottom: 2px;";
                        const img = document.createElement('img'); img.src = spriteUrl; img.title = unitName; img.style.cssText = "width: 16px; height: 16px;";
                        const timeSpan = document.createElement('span'); timeSpan.textContent = tempoFormatado;
                        lineDiv.appendChild(img); lineDiv.appendChild(timeSpan); tdTempos.appendChild(lineDiv);
                    }
                }

                tr.appendChild(tdAldeia);
                tr.appendChild(tdPontosVila);
                tr.appendChild(tdProprietario);
                tr.appendChild(tdTribe);
                tr.appendChild(tdDist);
                tr.appendChild(tdStatus);
                tr.appendChild(tdAction);
                tr.appendChild(tdTempos);
                tbody.appendChild(tr);
            });
            saveNew(newDataToSave);
            renderTribeSummary(tribeDataSummary);
        }

        function renderTribeSummary(summaryData) {
            const summaryContainer = tribeSummaryDiv.querySelector('div');
            summaryContainer.innerHTML = '';
            const tribesArray = Object.values(summaryData)
                .sort((a, b) => b.players.size - a.players.size || b.points - a.points);
            if (tribesArray.length === 0) {
                summaryContainer.textContent = 'Nenhuma tribo (exceto a sua) encontrada nas aldeias carregadas.';
                return;
            }
            const list = document.createElement('ul');
            list.style.cssText = "margin: 0; padding-left: 20px; font-size: 11px; list-style-type: disc;";
            tribesArray.slice(0, 10).forEach(tribe => {
                const listItem = document.createElement('li');
                const tribeLink = document.createElement('a');
                tribeLink.href = `/game.php?screen=info_ally&id=${tribe.id}`;
                tribeLink.textContent = tribe.name;
                listItem.appendChild(tribeLink);
                listItem.append(` (${tribe.points.toLocaleString('pt-BR')} pts) - ${tribe.players.size} Jogador(es), ${tribe.villageCount} Aldeia(s)`);
                list.appendChild(listItem);
            });
            summaryContainer.appendChild(list);
        }

        rebuild();

        const allRows = [...tabela.querySelectorAll("tbody tr")];
        filtrosDiv.querySelector("#filtroTodas").onclick = () => { allRows.forEach(r => (r.style.display = "")); };
        filtrosDiv.querySelector("#filtroBarbaras").onclick = () => { allRows.forEach(r => (r.style.display = r.dataset.tipo === "barbara" ? "" : "none")); };
        filtrosDiv.querySelector("#filtroPlayers").onclick = () => { allRows.forEach(r => (r.style.display = r.dataset.tipo === "player" ? "" : "none")); };
        filtrosDiv.querySelector("#filtroInativos").onclick = () => { allRows.forEach(r => { const s = r.dataset.status; r.style.display = (s === 'Estagnado' || s === 'Possivelmente inativo (72h)') ? "" : "none"; }); };
        filtrosDiv.querySelector("#btnFiltroPontos").onclick = () => {
            const min = parseInt(filtrosDiv.querySelector("#filtroPontosMin").value, 10) || 0;
            const searchTerm = buscaDiv.querySelector("#searchTableInput").value.toLowerCase();
            allRows.forEach(r => {
                const p = parseInt(r.dataset.pontosVila, 10) || 0;
                const isTargetStatus = r.dataset.tipo === 'barbara' || r.dataset.status === 'Estagnado' || r.dataset.status === 'Possivelmente inativo (72h)';
                const matchesSearch = searchTerm === '' ||
                                      r.cells[0].textContent.toLowerCase().includes(searchTerm) ||
                                      r.cells[2].textContent.toLowerCase().includes(searchTerm) ||
                                      r.cells[3].textContent.toLowerCase().includes(searchTerm);
                r.style.display = (isTargetStatus && p >= min && matchesSearch) ? "" : "none";
            });
        };
        btnToggleGraphsGlobal.onclick = function () {
            const btns = tabela.querySelectorAll("td:nth-child(3) button");
            if (btns.length === 0) return;
            const show = btns[0].textContent.includes("Mostrar");
            btns.forEach(btn => {
                if (btn.textContent.includes(show ? "Mostrar" : "Ocultar")) btn.click();
            });
        };
        buscaDiv.querySelector("#searchTableInput").addEventListener('input', (event) => {
            const searchTerm = event.target.value.toLowerCase();
            const minPointsFilterActive = !!filtrosDiv.querySelector("#filtroPontosMin").value;
            const minPointsValue = parseInt(filtrosDiv.querySelector("#filtroPontosMin").value, 10) || 0;
            allRows.forEach(row => {
                const textAldeia = row.cells[0].textContent.toLowerCase();
                const textPlayer = row.cells[2].textContent.toLowerCase();
                const textTribo = row.cells[3].textContent.toLowerCase();
                const matchesSearch = textAldeia.includes(searchTerm) || textPlayer.includes(searchTerm) || textTribo.includes(searchTerm);
                let shouldShow = matchesSearch;
                if(minPointsFilterActive) {
                    const p = parseInt(row.dataset.pontosVila, 10) || 0;
                    const isTargetStatus = row.dataset.tipo === 'barbara' || row.dataset.status === 'Estagnado' || row.dataset.status === 'Possivelmente inativo (72h)';
                    shouldShow = shouldShow && (isTargetStatus && p >= minPointsValue);
                }
                row.style.display = shouldShow ? "" : "none";
            });
        });

        const foot = document.createElement("div");
        foot.style.cssText = "margin-top: 8px; color: #444; display: flex; gap: 40px; flex-wrap: wrap;";
        const notasDiv = document.createElement("div");
        notasDiv.innerHTML = `<b>Notas:</b> <ul style="margin:4px 0 0 18px; padding:0; list-style-type: disc;"> <li>Gráficos de pontos são carregados do <i>twstats.com</i>.</li> <li>Tempos de chegada calculados com base nas velocidades (min/campo).</li> <li>Evolução de pontos da aldeia compara com registro de ~24h atrás (ou mais antigo).</li> </ul>`;
        const legendasDiv = document.createElement("div");
        legendasDiv.innerHTML = `<b>Legendas (Cores de Fundo):</b> <ul style="margin:4px 0 0 18px; padding:0; list-style-type: none;"> <li style="display:flex; align-items: center; margin-bottom: 2px;"><div style="width:12px; height:12px; background:#f3e5f5; border: 1px solid #ccc; margin-right: 5px;"></div> Aldeia Própria</li> <li style="display:flex; align-items: center; margin-bottom: 2px;"><div style="width:12px; height:12px; background:#e3f2fd; border: 1px solid #ccc; margin-right: 5px;"></div> Aliado</li> <li style="display:flex; align-items: center; margin-bottom: 2px;"><div style="width:12px; height:12px; background:#e8f5e9; border: 1px solid #ccc; margin-right: 5px;"></div> Player Ativo</li> <li style="display:flex; align-items: center; margin-bottom: 2px;"><div style="width:12px; height:12px; background:#ffffff; border: 1px solid #ccc; margin-right: 5px;"></div> Player Desconhecido/Em Análise</li> <li style="display:flex; align-items: center; margin-bottom: 2px;"><div style="width:12px; height:12px; background:#fff3e0; border: 1px solid #ccc; margin-right: 5px;"></div> Player Estagnado</li> <li style="display:flex; align-items: center; margin-bottom: 2px;"><div style="width:12px; height:12px; background:#ffebee; border: 1px solid #ccc; margin-right: 5px;"></div> Player Poss. Inativo (72h)</li> <li style="display:flex; align-items: center; margin-bottom: 2px;"><div style="width:12px; height:12px; background:#f0f0f0; border: 1px solid #ccc; margin-right: 5px;"></div> Aldeia Bárbara</li> <li style="display:flex; align-items: center; margin-bottom: 2px;"><div style="width:12px; height:12px; background:#fff9c4; border: 1px solid #ccc; margin-right: 5px;"></div> Bárbara (com Bônus)</li> </ul> <b style="display: block; margin-top: 8px;">Legendas (Status):</b> <ul style="margin:4px 0 0 18px; padding:0; list-style-type: disc;"> <li><b>Ativo:</b> Ganhou pontos desde a última verificação (>1h) OU nas últimas 24h.</li> <li><b>Estagnado:</b> Pontuação igual há mais de 24h.</li> <li><b>Possivelmente inativo (72h):</b> Pontuação menor ou igual há mais de 72h.</li> <li><b>Em análise:</b> Histórico existe (>1 registro), mas sem ganho recente (<24h) e sem perda significativa.</li><li><b>Desconhecido:</b> Apenas 1 registro no histórico.</li> </ul>`;
        container.appendChild(foot);
        foot.appendChild(notasDiv);
        foot.appendChild(legendasDiv);
    }

    function waitForGameData() {
        const MAX_TRIES = 50;
        let tries = 0;
        const checker = setInterval(() => {
            if (typeof game_data?.village?.id !== 'undefined' && typeof TWMap?.villages !== 'undefined' && typeof game_data?.player?.id !== 'undefined'
                && typeof game_data?.features !== 'undefined'
            ) {
                clearInterval(checker);
                runScript();
            } else if (tries >= MAX_TRIES) {
                clearInterval(checker);
                console.error("Scanner de Vizinhança: Timeout! Não foi possível carregar os dados do jogo.");
                alert("Scanner de Vizinhança: Falha ao carregar. Tente recarregar a página.");
            } else {
                tries++;
            }
        }, 200);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', waitForGameData);
    } else {
        waitForGameData();
    }

})();