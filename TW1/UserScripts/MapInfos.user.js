// ==UserScript==
// @name         Scanner de vizinhança
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Escanear a vizinhança no tribal wars
// @author       teudm
// @match        https://*.tribalwars.com.br/*screen=map*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=tribalwars.com.br
// @downloadURL  https://raw.githubusercontent.com/teudm/twscrpts/main/TW1/UserScript/MapInfos.user.js
// @updateURL    https://github.com/teudm/twscrpts/TW1/raw/main/UserScript/MapInfos.user.js
// ==/UserScript==

(function () {
    // ==========================================================
    // NOVA FUNÇÃO DE INICIALIZAÇÃO PARA AGUARDAR DADOS DO JOGO
    // ==========================================================
    const MAX_TRIES = 50; // Tenta por no máximo 10 segundos (50 * 200ms)
    let tries = 0;

    function init() {
        // Verifica se os objetos essenciais do jogo já foram carregados
        if (window.game_data && window.game_data.village && window.TWMap && window.TWMap.villages) {
            main(); // Se sim, executa o script principal
        } else if (tries < MAX_TRIES) {
            tries++;
            setTimeout(init, 200); // Se não, tenta novamente em 200ms
        } else {
            // Se exceder o tempo limite, exibe um erro
            console.error("Scanner de Vizinhança: Timeout. Não foi possível carregar os dados do jogo.");
            alert("Scanner de Vizinhança: Não foi possível carregar os dados do jogo após 10 segundos. Tente recarregar a página.");
        }
    }

    // ==========================================================
    // ENVOLVE TODO O CÓDIGO PRINCIPAL NA FUNÇÃO main()
    // ==========================================================
    function main() {
        // ========== CONFIG ==========
        const STORAGE_KEY = "scannerVizinhosData_v3";
        const FIXED_RADIUS = 1000; // campos

        // === LIMITES DE STATUS ===
        const STAGNANT_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 1 dia
        const INACTIVE_THRESHOLD_MS = 72 * 60 * 60 * 1000; // 3 dias (72h)

        // === VELOCIDADES FINAIS DAS TROPAS (minutos/campo) ===
        const UNIT_BASE_SPEEDS = {
            spear: 18,
            sword: 22,
            axe: 18,
            spy: 9,
            light: 10,
            heavy: 11,
            ram: 29,
            catapult: 29,
            knight: 10,
            snob: 35
        };

        // === URL base estática para sprites das unidades ===
        const STATIC_IMAGE_BASE_URL = "https://dsbr.innogamescdn.com/asset/caf5a096/graphic/unit/recruit/";
        // ============================

        // --- utilitários ---
        function getGameData() { return window.game_data || {}; }
        function getTWMapVillages() { return window.TWMap && TWMap.villages ? TWMap.villages : null; }
        function getPlayers() { return window.TWMap && TWMap.players ? TWMap.players : {}; }
        function getAllies() { return window.TWMap && TWMap.allies ? TWMap.allies : {}; }

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
            return Math.sqrt((v1.x - v2.x) ** 2 + (v1.y - v2.y) ** 2);
        }

        function safeParseInt(str) {
            if (!str) return 0;
            return parseInt(String(str).replace(/\./g, ''), 10) || 0;
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
            const graphContainerId = btn.dataset.graphId;
            if (!graphContainerId) return;
            const container = document.getElementById(graphContainerId);
            if (!container) return;
            const isShowing = container.style.display !== 'none';
            if (isShowing) {
                container.style.display = 'none';
                btn.textContent = btn.textContent.replace("Ocultar", "Mostrar");
            } else {
                container.style.display = 'block';
                btn.textContent = btn.textContent.replace("Mostrar", "Ocultar");
                const images = container.querySelectorAll('img');
                images.forEach(img => {
                    if (!img.src && img.dataset.src) {
                        img.src = img.dataset.src;
                    }
                });
            }
        }

        function toggleBonus(event) {
            event.preventDefault();
            event.stopPropagation();
            const bonusDescId = event.target.dataset.bonusId;
            if (!bonusDescId) return;
            const desc = document.getElementById(bonusDescId);
            if (!desc) return;
            const isVisible = desc.style.display === 'block';
            desc.style.display = isVisible ? 'none' : 'block';
        }

        function createGraphLabel(text) {
            const label = document.createElement('small');
            label.style.display = 'block';
            label.style.fontWeight = 'bold';
            label.style.marginTop = '6px';
            label.textContent = text;
            return label;
        }

        function createGraphImage(srcUrl, alt) {
            const img = document.createElement('img');
            img.dataset.src = srcUrl;
            img.style.width = '100%';
            img.style.maxWidth = '500px';
            img.alt = alt;
            img.onerror = () => { img.alt = 'Erro ao carregar gráfico.'; img.parentElement.textContent = 'Erro ao carregar gráfico.'; };
            return img;
        }

        // ========== início ==========
        const gameData = getGameData();
        const minhaAldeia = gameData.village;
        const meuPlayerId = gameData.player ? String(gameData.player.id) : null;
        const minhaTriboId = gameData.player ? safeParseInt(gameData.player.ally) : null;
        const todasVilas = getTWMapVillages();
        const players = getPlayers();
        const tribos = getAllies();

        // O check de erro original pode ser removido, pois a função init já garante que os dados existem
        // if (!minhaAldeia || !todasVilas || !gameData.world || !gameData.market || !meuPlayerId) { ... }

        const old = document.getElementById("scannerVizinhos");
        if (old) old.remove();
        const container = document.createElement("div");
        container.id = "scannerVizinhos";
        container.style.cssText = "background: #f9f9f9; border: 1px solid #bbb; margin-top: 10px; padding: 8px; font-size: 13px;";
        const header = document.createElement("div");
        header.style.cssText = "display: flex; gap: 8px; align-items: center; flex-wrap: wrap;";
        header.innerHTML = `<b>Scanner de aldeias próximas</b> — Raio fixo: ${FIXED_RADIUS} campos`;
        const btnToggleGraphsGlobal = document.createElement("button");
        btnToggleGraphsGlobal.textContent = "Mostrar/Ocultar todos gráficos";
        header.appendChild(btnToggleGraphsGlobal);
        container.appendChild(header);
        const filtrosDiv = document.createElement("div");
        filtrosDiv.style.cssText = "margin-top: 8px; padding: 5px; border: 1px solid #eee; background-color: #fafafa;";
        filtrosDiv.innerHTML = `<b>Filtros:</b> <button id="filtroTodas" style="margin-left: 5px;">Mostrar todas</button> <button id="filtroBarbaras">Apenas bárbaras</button> <button id="filtroPlayers">Apenas players</button> <button id="filtroInativos">Apenas inativos</button> <span style="border-left: 1px solid #ccc; margin: 0 10px;"></span> <input type="text" id="filtroPontosMin" placeholder="Pontos mín." style="width: 80px; font-size: 11px; padding: 2px;"> <button id="btnFiltroPontos">Filtrar Bárbaras/Inativas</button>`;
        container.appendChild(filtrosDiv);
        const tabelaWrapper = document.createElement("div");
        tabelaWrapper.style.cssText = "max-height: 600px; overflow-y: auto; margin-top: 8px; border-top: 1px solid #ccc; border-bottom: 1px solid #ccc;";
        const tabela = document.createElement("table");
        tabela.style.cssText = "width: 100%; border-collapse: collapse;";
        const stickyStyles = "padding:4px; border:1px solid #ddd; position: sticky; top: 0; background: #eee; z-index: 1;";
        tabela.innerHTML = `<thead> <tr style="background:#eee"> <th style="${stickyStyles} width: 150px;">Aldeia</th> <th style="${stickyStyles} width: 90px;">Pontos (Aldeia)</th> <th style="${stickyStyles} width: 150px;">Proprietário</th> <th style="${stickyStyles}">Tribo</th> <th style="${stickyStyles}">Distância</th> <th style="${stickyStyles}">Status</th> <th style="${stickyStyles}">Ação</th> <th style="${stickyStyles} width: 130px;">Tempo de Chegada</th> </tr> </thead> <tbody></tbody>`;
        tabelaWrapper.appendChild(tabela);
        container.appendChild(tabelaWrapper);
        const target = document.querySelector("#content_value") || document.body;
        target.appendChild(container);

        function loadOld() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; } }
        function saveNew(obj) { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); }

        function rebuild() {
            const arrV = Object.values(todasVilas).map(v => extrairCoordenadas(Object.assign({}, v))).map(v => ({ ...v, dist: distancia(minhaAldeia, v) })).filter(v => v.dist <= FIXED_RADIUS).sort((a, b) => a.dist - b.dist);
            const tbody = tabela.querySelector("tbody");
            tbody.innerHTML = "";
            const oldData = loadOld();
            const newDataToSave = {};
            const serverDomain = gameData.market;
            const worldId = gameData.world;
            const now = Date.now();
            arrV.forEach(v => {
                const player = players[v.owner];
                const ownerName = player ? player.name : "Bárbara";
                const playerId = player ? String(v.owner) : null;
                const isOwner = playerId && meuPlayerId && playerId === meuPlayerId;
                const pontosJogador = player ? safeParseInt(player.points) : 0;
                const pontosVila = safeParseInt(v.points);
                const nomeAldeia = v.name || `${v.x}|${v.y}`;
                const coordsAldeia = `${v.x}|${v.y}`;
                const triboId = player ? safeParseInt(player.ally) : null;
                const triboData = triboId ? tribos[triboId] : null;
                const triboName = triboData ? (triboData.name || "—") : "—";
                const triboPoints = triboData ? safeParseInt(triboData.points) : 0;
                const triboMembers = triboData ? safeParseInt(triboData.members) : 0;
                const isAlly = minhaTriboId && triboId && minhaTriboId === triboId;
                const bonusData = (!playerId && v.bonus_id && v.bonus_id != "0" && v.bonus && v.bonus.length > 0) ? v.bonus[0] : null;
                const villageStorageKey = 'v_' + v.x + '|' + v.y;
                const prevVillageData = oldData[villageStorageKey] || { history: [] };
                const oldVillageHistory = prevVillageData.history || [];
                const lastVillageEntry = oldVillageHistory.length > 0 ? oldVillageHistory[oldVillageHistory.length - 1] : null;
                let pontosVilaDiffLast = 0;
                if (lastVillageEntry) { pontosVilaDiffLast = pontosVila - lastVillageEntry.p; }
                let newVillageHistory = [...oldVillageHistory];
                if (!lastVillageEntry || (now - lastVillageEntry.ts) > 3600 * 1000) { newVillageHistory.push({ ts: now, p: pontosVila }); }
                if (newVillageHistory.length > 30) newVillageHistory.shift();
                newDataToSave[villageStorageKey] = { history: newVillageHistory };
                let status = "N/A";
                if (playerId) {
                    const prevData = oldData[playerId] || { history: [] };
                    const oldHistory = prevData.history || [];
                    if (isOwner) { status = "Própria"; }
                    else if (oldHistory.length === 0) { status = "Desconhecido"; }
                    else {
                        const stagnantTime = now - STAGNANT_THRESHOLD_MS;
                        const inactiveTime = now - INACTIVE_THRESHOLD_MS;
                        const stagnantEntry = oldHistory.slice().reverse().find(e => e.ts < stagnantTime);
                        const inactiveEntry = oldHistory.slice().reverse().find(e => e.ts < inactiveTime);
                        const lastEntry = oldHistory[oldHistory.length - 1];
                        if (inactiveEntry && pontosJogador === inactiveEntry.p) { status = "Inativo (72h)"; }
                        else if (stagnantEntry && pontosJogador <= stagnantEntry.p) { status = "Estagnado"; }
                        else if (pontosJogador > lastEntry.p) { status = "Ativo"; }
                        else { status = "Desconhecido"; }
                    }
                    if (!isOwner) {
                        let newHistory = [...oldHistory];
                        const lastPEntry = oldHistory.length > 0 ? oldHistory[oldHistory.length - 1] : null;
                        if (!lastPEntry || (now - lastPEntry.ts) > 3600 * 1000) { newHistory.push({ ts: now, p: pontosJogador }); }
                        if (newHistory.length > 30) newHistory.shift();
                        newDataToSave[playerId] = { history: newHistory };
                    }
                }
                const tr = document.createElement("tr");
                tr.dataset.tipo = playerId ? "player" : "barbara";
                tr.dataset.pontosVila = pontosVila;
                tr.dataset.status = status;
                if (isOwner) { tr.style.backgroundColor = '#f3e5f5'; }
                else if (bonusData) { tr.style.backgroundColor = '#fff9c4'; }
                else if (isAlly) { tr.style.backgroundColor = "#bceeff"; }
                else if (!playerId) { tr.style.backgroundColor = "#f0f0f0"; }
                else if (status === "Inativo (72h)") { tr.style.backgroundColor = "#ffebee"; }
                else if (status === "Estagnado") { tr.style.backgroundColor = "#fff3e0"; }
                else if (status === "Ativo") { tr.style.backgroundColor = "#e8f5e9"; }
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
                if (lastVillageEntry) {
                    const diffSpan = document.createElement('span');
                    diffSpan.style.cssText = "display: block; font-size: 10px;";
                    if (pontosVilaDiffLast > 0) { diffSpan.textContent = `(+${pontosVilaDiffLast.toLocaleString('pt-BR')})`; diffSpan.style.color = 'green'; }
                    else if (pontosVilaDiffLast < 0) { diffSpan.textContent = `(${pontosVilaDiffLast.toLocaleString('pt-BR')})`; diffSpan.style.color = 'red'; }
                    else { diffSpan.textContent = `(=0)`; diffSpan.style.color = 'gray'; }
                    tdPontosVila.appendChild(diffSpan);
                }
                const tdProprietario = document.createElement("td");
                tdProprietario.style.cssText = "padding: 4px; border: 1px solid #ddd;";
                if (playerId) {
                    const link = document.createElement("a");
                    link.href = `/game.php?screen=info_player&id=${playerId}`;
                    link.textContent = ownerName;
                    if (isOwner) { link.style.cssText = "color: #6a1b9a; font-weight: bold;"; }
                    tdProprietario.appendChild(link);
                    const pontosPlayerSpan = document.createElement("span");
                    pontosPlayerSpan.style.cssText = "margin-left: 4px; font-size: 11px; color: #555;";
                    pontosPlayerSpan.textContent = `(${pontosJogador.toLocaleString('pt-BR')})`;
                    tdProprietario.appendChild(pontosPlayerSpan);
                    if (!isOwner) {
                        const btnGraph = document.createElement("button");
                        btnGraph.textContent = "Mostrar Gráficos";
                        btnGraph.style.cssText = "display: block; margin-top: 4px; font-size: 11px;";
                        btnGraph.onclick = toggleGraph;
                        const graphContainerPlayer = document.createElement('div');
                        graphContainerPlayer.id = 'graph_cont_p_' + playerId;
                        graphContainerPlayer.style.display = 'none';
                        btnGraph.dataset.graphId = graphContainerPlayer.id;
                        const graphUrlPlayerP = `https://${serverDomain}.twstats.com/image.php?type=playergraph&id=${playerId}&s=${worldId}&graph=points`;
                        graphContainerPlayer.appendChild(createGraphLabel('Pontos:'));
                        graphContainerPlayer.appendChild(createGraphImage(graphUrlPlayerP, `Gráfico Pontos ${ownerName}`));
                        const graphUrlPlayerODA = `https://${serverDomain}.twstats.com/image.php?type=playergraph&id=${playerId}&s=${worldId}&graph=oda`;
                        graphContainerPlayer.appendChild(createGraphLabel('ODA (Ataque):'));
                        graphContainerPlayer.appendChild(createGraphImage(graphUrlPlayerODA, `Gráfico ODA ${ownerName}`));
                        const graphUrlPlayerODD = `https://` + `${serverDomain}.twstats.com/image.php?type=playergraph&id=${playerId}&s=${worldId}&graph=odd`;
                        graphContainerPlayer.appendChild(createGraphLabel('ODD (Defesa):'));
                        graphContainerPlayer.appendChild(createGraphImage(graphUrlPlayerODD, `Gráfico ODD ${ownerName}`));
                        tdProprietario.appendChild(btnGraph);
                        tdProprietario.appendChild(graphContainerPlayer);
                    }
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
                    if (triboPoints > 0) infoText += `Pontos: ${triboPoints.toLocaleString('pt-BR')}`;
                    if (triboMembers > 0) infoText += infoText ? ` | Membros: ${triboMembers}` : `Membros: ${triboMembers}`;
                    if (infoText) { tribeInfoSpan.textContent = `(${infoText})`; tdTribe.appendChild(tribeInfoSpan); }
                } else { tdTribe.textContent = triboName; }
                const tdDist = document.createElement("td");
                tdDist.style.cssText = "padding: 4px; border: 1px solid #ddd;";
                tdDist.textContent = v.dist.toFixed(2);
                const tdStatus = document.createElement("td");
                tdStatus.style.cssText = "padding: 4px; border: 1px solid #ddd;";
                tdStatus.textContent = status;
                if (status === "Ativo") tdStatus.style.color = "green";
                else if (status === "Inativo (72h)") tdStatus.style.color = "red";
                else if (status === "Estagnado") tdStatus.style.color = "orange";
                else if (status === "Própria") tdStatus.style.color = "#6a1b9a";
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
                    if (!playerId || status === "Estagnado" || status === "Inativo (72h)") {
                        linkAttack.style.cssText = btnBaseStyle + "background-color: #ffebee; color: #b71c1c; border-color: #e57373; font-weight: bold;";
                        linkAttack.onmouseover = () => { linkAttack.style.backgroundColor = '#ffcdd2'; };
                        linkAttack.onmouseout = () => { linkAttack.style.backgroundColor = '#ffebee'; };
                    } else {
                        linkAttack.style.cssText = btnBaseStyle + "background-color: #f5f5f5; color: #555; border-color: #ccc;";
                        linkAttack.onmouseover = () => { linkAttack.style.backgroundColor = '#eeeeee'; };
                        linkAttack.onmouseout = () => { linkAttack.style.backgroundColor = '#f5f5f5'; };
                    }
                    actionContainer.appendChild(linkAttack);
                    const linkCentralize = document.createElement("a");
                    linkCentralize.href = `/game.php?screen=map&x=${v.x}&y=${v.y}`;
                    linkCentralize.textContent = "Centralizar";
                    linkCentralize.style.cssText = btnBaseStyle + "background-color: #e3f2fd; color: #0d47a1; border-color: #90caf9;";
                    linkCentralize.onmouseover = () => { linkCentralize.style.backgroundColor = '#bbdefb'; };
                    linkCentralize.onmouseout = () => { linkCentralize.style.backgroundColor = '#e3f2fd'; };
                    actionContainer.appendChild(linkCentralize);
                }
                if (isAlly && !isOwner) {
                    tdAldeia.style.fontWeight = 'bold'; tdAldeia.style.color = '#1b5e20';
                    tdTribe.style.fontWeight = 'bold'; tdTribe.style.color = '#1b5e20';
                    Array.from(tdTribe.children).forEach(child => { child.style.fontWeight = 'bold'; child.style.color = '#1b5e20'; });
                }
                if (isOwner) {
                    tdAldeia.style.color = '#6a1b9a'; tdAldeia.style.fontWeight = 'bold';
                    if (tdTribe.children.length > 0) { Array.from(tdTribe.children).forEach(child => { child.style.fontWeight = 'bold'; child.style.color = '#6a1b9a'; }); }
                }
                const tdTempos = document.createElement("td");
                tdTempos.style.cssText = "padding: 4px; border: 1px solid #ddd; font-size: 11px;";
                if (v.dist === 0) { tdTempos.textContent = "---"; tdTempos.style.textAlign = 'center'; }
                else { for (const unitName in UNIT_BASE_SPEEDS) { const tempoFormatado = formatarTempo(v.dist * UNIT_BASE_SPEEDS[unitName]); const lineDiv = document.createElement('div'); lineDiv.style.cssText = "display: flex; align-items: center; gap: 4px; margin-bottom: 2px;"; const img = document.createElement('img'); img.src = `${STATIC_IMAGE_BASE_URL}${unitName}.webp`; img.title = unitName; img.alt = unitName; img.style.cssText = "width: 16px; height: 16px;"; const timeSpan = document.createElement('span'); timeSpan.textContent = tempoFormatado; lineDiv.appendChild(img); lineDiv.appendChild(timeSpan); tdTempos.appendChild(lineDiv); } }
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
        }

        rebuild();

        const allRows = [...tabela.querySelectorAll("tbody tr")];
        filtrosDiv.querySelector("#filtroTodas").onclick = () => { allRows.forEach(r => (r.style.display = "")); };
        filtrosDiv.querySelector("#filtroBarbaras").onclick = () => { allRows.forEach(r => (r.style.display = r.dataset.tipo === "barbara" ? "" : "none")); };
        filtrosDiv.querySelector("#filtroPlayers").onclick = () => { allRows.forEach(r => (r.style.display = r.dataset.tipo === "player" ? "" : "none")); };
        filtrosDiv.querySelector("#filtroInativos").onclick = () => { allRows.forEach(r => { const s = r.dataset.status; r.style.display = (s === 'Estagnado' || s === 'Inativo (72h)') ? "" : "none"; }); };
        filtrosDiv.querySelector("#btnFiltroPontos").onclick = () => { const min = parseInt(filtrosDiv.querySelector("#filtroPontosMin").value, 10) || 0; allRows.forEach(r => { const p = parseInt(r.dataset.pontosVila, 10) || 0; r.style.display = ((r.dataset.tipo === 'barbara' || r.dataset.status === 'Estagnado' || r.dataset.status === 'Inativo (72h)') && p >= min) ? "" : "none"; }); };
        btnToggleGraphsGlobal.onclick = function () { const btns = tabela.querySelectorAll("td:nth-child(3) button"); if (btns.length === 0) return; const show = btns[0].textContent.startsWith("Mostrar"); btns.forEach(btn => { const isShowing = btn.textContent.startsWith("Ocultar"); if ((show && !isShowing) || (!show && isShowing)) btn.click(); }); };
        const foot = document.createElement("div");
        foot.style.cssText = "margin-top: 8px; color: #444; display: flex; gap: 40px; flex-wrap: wrap;";
        const notasDiv = document.createElement("div");
        notasDiv.innerHTML = `<b>Notas:</b> <ul style="margin:4px 0 0 18px; padding:0; list-style-type: disc;"> <li>Gráficos de pontos são carregados do <i>twstats.com</i>.</li> <li>Tempos de chegada são calculados com base nas velocidades (min/campo) definidas no topo do script.</li> <li>Evolução de pontos da aldeia (ex: +10) compara com o último registro salvo.</li> </ul>`;
        const legendasDiv = document.createElement("div");
        legendasDiv.innerHTML = `<b>Legendas (Cores de Fundo):</b> <ul style="margin:4px 0 0 18px; padding:0; list-style-type: none;"> <li style="display:flex; align-items: center; margin-bottom: 2px;"><div style="width:12px; height:12px; background:#f3e5f5; border: 1px solid #ccc; margin-right: 5px;"></div> Aldeia Própria</li> <li style="display:flex; align-items: center; margin-bottom: 2px;"><div style="width:12px; height:12px; background:#bceeff; border: 1px solid #ccc; margin-right: 5px;"></div> Aliado (mesma tribo)</li> <li style="display:flex; align-items: center; margin-bottom: 2px;"><div style="width:12px; height:12px; background:#e8f5e9; border: 1px solid #ccc; margin-right: 5px;"></div> Player Ativo</li> <li style="display:flex; align-items: center; margin-bottom: 2px;"><div style="width:12px; height:12px; background:#ffffff; border: 1px solid #ccc; margin-right: 5px;"></div> Player Desconhecido</li> <li style="display:flex; align-items: center; margin-bottom: 2px;"><div style="width:12px; height:12px; background:#fff3e0; border: 1px solid #ccc; margin-right: 5px;"></div> Player Estagnado</li> <li style="display:flex; align-items: center; margin-bottom: 2px;"><div style="width:12px; height:12px; background:#ffebee; border: 1px solid #ccc; margin-right: 5px;"></div> Player Inativo (72h)</li> <li style="display:flex; align-items: center; margin-bottom: 2px;"><div style="width:12px; height:12px; background:#f0f0f0; border: 1px solid #ccc; margin-right: 5px;"></div> Aldeia Bárbara</li> <li style="display:flex; align-items: center; margin-bottom: 2px;"><div style="width:12px; height:12px; background:#fff9c4; border: 1px solid #ccc; margin-right: 5px;"></div> Aldeia Bárbara (com Bônus)</li> </ul> <b style="display: block; margin-top: 8px;">Legendas (Status de Atividade):</b> <ul style="margin:4px 0 0 18px; padding:0; list-style-type: disc;"> <li><b>Ativo:</b> Ganhou pontos desde a última verificação.</li> <li><b>Estagnado:</b> Sem ganhar pontos há mais de 24h.</li> <li><b>Inativo (72h):</b> Sem ganhar pontos há mais de 72h.</li> <li><b>Desconhecido:</b> Sem histórico OU sem ganho de pontos recentes (<24h).</li> <li><b>Própria:</b> Pertence a você.</li> </ul>`;
        container.appendChild(foot);
        foot.appendChild(notasDiv);
        foot.appendChild(legendasDiv);
    }

    // ==========================================================
    // INICIA A VERIFICAÇÃO
    // ==========================================================
    init();

})();