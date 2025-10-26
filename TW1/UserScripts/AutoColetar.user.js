// ==UserScript==
// @name         Scanner de vizinhança
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Escanear a vizinhança no tribal wars
// @author       teudm
// @match        https://*.tribalwars.com.br/*screen=map*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=tribalwars.com.br
// @downloadURL  https://raw.githubusercontent.com/teudm/twscrpts/main/TW1/UserScript/MapInfos.user.js
// @updateURL    https://github.com/teudm/twscrpts/TW1/raw/main/UserScript/MapInfos.user.js
// ==/UserScript==

(function () {
    'use strict';

    function runScript() {
        // ========== CONFIG ==========
        const STORAGE_KEY = "scannerVizinhosData_v3";
        const FIXED_RADIUS = 1000;
        const HISTORY_LIMIT = 10; // Limite de registros no histórico

        // Limites de tempo para determinar status
        const STAGNANT_THRESHOLD_MS = 24 * 60 * 60 * 1000;
        const INACTIVE_THRESHOLD_MS = 72 * 60 * 60 * 1000;

        // Velocidades base das unidades (minutos/campo)
        const UNIT_BASE_SPEEDS = {
            spear: 18, sword: 22, axe: 18, spy: 9, light: 10,
            heavy: 11, ram: 29, catapult: 29, knight: 10, snob: 35
        };

        // URL base para os ícones das unidades
        const STATIC_IMAGE_BASE_URL = "https://dsbr.innogamescdn.com/asset/caf5a096/graphic/unit/recruit/";
        // ============================

        // --- utilitários ---
        function getGameData() { return game_data || {}; }
        function getTWMapVillages() { return TWMap && TWMap.villages ? TWMap.villages : null; }
        function getPlayers() { return TWMap && TWMap.players ? TWMap.players : {}; }
        function getAllies() { return TWMap && TWMap.allies ? TWMap.allies : {}; }

        // Extrai coordenadas X e Y do objeto da aldeia
        function extrairCoordenadas(v) {
            if (v.x === undefined || v.y === undefined) {
                const xy = v.xy || v.XY || v.coords || 0;
                const n = Number(xy) || 0;
                v.x = Math.floor(n / 1000);
                v.y = n % 1000;
            }
            return v;
        }

        // Calcula a distância euclidiana entre duas aldeias
        function distancia(v1, v2) {
            if (v1.x === undefined || v1.y === undefined) v1 = extrairCoordenadas(v1);
            if (v2.x === undefined || v2.y === undefined) v2 = extrairCoordenadas(v2);
            return Math.sqrt(Math.pow(v1.x - v2.x, 2) + Math.pow(v1.y - v2.y, 2));
        }

        // Converte string com pontos (ex: "1.234") para inteiro
        function safeParseInt(str) {
            if (!str) return 0;
            return parseInt(String(str).replace(/\./g, ''), 10) || 0;
        }

        // Formata minutos em HH:MM:SS
        function formatarTempo(minutos) {
            if (minutos < 0 || !isFinite(minutos)) return "N/A";
            const h = Math.floor(minutos / 60);
            const m = Math.floor(minutos % 60);
            const s = Math.floor((minutos * 60) % 60);
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }

        // Mostra/Oculta o contêiner de gráficos e carrega imagens (lazy load)
        function toggleGraph(event) {
            const btn = event.target;
            const container = document.getElementById(btn.dataset.graphId);
            if (!container) return;
            const isShowing = container.style.display !== 'none';
            container.style.display = isShowing ? 'none' : 'block';
            btn.textContent = btn.textContent.replace(isShowing ? "Ocultar" : "Mostrar", isShowing ? "Mostrar" : "Ocultar");
            if (!isShowing) {
                container.querySelectorAll('img[data-src]').forEach(img => {
                    if (!img.src) img.src = img.dataset.src; // Carrega imagem
                });
            }
        }

        // Mostra/Oculta a descrição do bônus da aldeia
        function toggleBonus(event) {
            event.preventDefault();
            const desc = document.getElementById(event.target.dataset.bonusId);
            if (desc) desc.style.display = desc.style.display === 'block' ? 'none' : 'block';
        }

        // Cria a label (título) para um gráfico
        function createGraphLabel(text) {
            const label = document.createElement('small');
            label.style.cssText = 'display: block; font-weight: bold; margin-top: 6px;';
            label.textContent = text;
            return label;
        }

        // Cria o elemento <img> para um gráfico (com data-src para lazy load)
        function createGraphImage(srcUrl, alt) {
            const img = document.createElement('img');
            img.dataset.src = srcUrl;
            img.style.cssText = 'width: 100%; max-width: 500px;';
            img.alt = alt;
            img.onerror = () => { if(img.parentElement) img.parentElement.textContent = 'Erro ao carregar gráfico.'; };
            return img;
        }

        // ========== início ==========
        const gameData = getGameData();
        const minhaAldeia = gameData.village;
        const meuPlayerId = gameData.player.id.toString();
        const minhaTriboId = safeParseInt(gameData.player.ally);
        const todasVilas = getTWMapVillages();
        const players = getPlayers();
        const tribos = getAllies();

        // Remove instância anterior do painel, se existir
        const old = document.getElementById("scannerVizinhos");
        if (old) old.remove();

        // Cria o container principal
        const container = document.createElement("div");
        container.id = "scannerVizinhos";
        container.style.cssText = "background: #f9f9f9; border: 1px solid #bbb; margin-top: 10px; padding: 8px; font-size: 13px;";

        // Cria o cabeçalho
        const header = document.createElement("div");
        header.style.cssText = "display: flex; gap: 8px; align-items: center; flex-wrap: wrap;";
        header.innerHTML = `<b>Scanner de aldeias próximas</b> — Raio fixo: ${FIXED_RADIUS} campos`;
        const btnToggleGraphsGlobal = document.createElement("button");
        btnToggleGraphsGlobal.textContent = "Mostrar/Ocultar todos gráficos";
        header.appendChild(btnToggleGraphsGlobal);
        container.appendChild(header);

        // Cria a seção de filtros
        const filtrosDiv = document.createElement("div");
        filtrosDiv.style.cssText = "margin-top: 8px; padding: 5px; border: 1px solid #eee; background-color: #fafafa;";
        filtrosDiv.innerHTML = `
            <b>Filtros:</b>
            <button id="filtroTodas" style="margin-left: 5px;">Mostrar todas</button>
            <button id="filtroBarbaras">Apenas bárbaras</button>
            <button id="filtroPlayers">Apenas players</button>
            <button id="filtroInativos">Apenas inativos</button>
            <span style="border-left: 1px solid #ccc; margin: 0 10px;"></span>
            <input type="text" id="filtroPontosMin" placeholder="Pontos mín." style="width: 80px; font-size: 11px; padding: 2px;">
            <button id="btnFiltroPontos">Filtrar Bárbaras/Inativas</button>
        `;
        container.appendChild(filtrosDiv);

        // Cria o wrapper da tabela com scroll e cabeçalho fixo
        const tabelaWrapper = document.createElement("div");
        tabelaWrapper.style.cssText = "max-height: 600px; overflow-y: auto; margin-top: 8px; border-top: 1px solid #ccc; border-bottom: 1px solid #ccc;";
        const tabela = document.createElement("table");
        tabela.style.cssText = "width: 100%; border-collapse: collapse;";
        const stickyStyles = "padding:4px; border:1px solid #ddd; position: sticky; top: 0; background: #eee; z-index: 1;";
        tabela.innerHTML = `
            <thead>
                <tr>
                    <th style="${stickyStyles} width: 150px;">Aldeia</th>
                    <th style="${stickyStyles} width: 90px;">Pontos (Aldeia)</th>
                    <th style="${stickyStyles} width: 150px;">Proprietário</th>
                    <th style="${stickyStyles}">Tribo</th>
                    <th style="${stickyStyles}">Distância</th>
                    <th style="${stickyStyles}">Status</th>
                    <th style="${stickyStyles}">Ação</th>
                    <th style="${stickyStyles} width: 130px;">Tempo de Chegada</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        tabelaWrapper.appendChild(tabela);
        container.appendChild(tabelaWrapper);

        // Anexa o container principal ao DOM
        const target = document.querySelector("#content_value") || document.body;
        target.appendChild(container);

        // Funções para carregar/salvar dados do localStorage
        function loadOld() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; } }
        function saveNew(obj) { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); }

        // Função principal para construir a tabela
        function rebuild() {
            // Processa as aldeias: extrai coords, calcula dist, filtra raio, ordena
            const arrV = Object.values(todasVilas)
                .map(v => extrairCoordenadas({ ...v }))
                .map(v => ({ ...v, dist: distancia(minhaAldeia, v) }))
                .filter(v => v.dist <= FIXED_RADIUS)
                .sort((a, b) => a.dist - b.dist);

            const tbody = tabela.querySelector("tbody");
            tbody.innerHTML = ""; // Limpa a tabela
            const oldData = loadOld();
            const newDataToSave = {}; // Objeto para acumular dados a serem salvos
            const serverDomain = gameData.market;
            const worldId = gameData.world;
            const now = Date.now();

            arrV.forEach(v => {
                // Dados básicos da aldeia e jogador
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

                // --- Histórico e Pontos da ALDEIA (Comparação 24h ou vs Mais Antigo) ---
                const villageStorageKey = `v_${coordsAldeia}`;
                const prevVillageData = oldData[villageStorageKey] || { history: [] };
                const oldVillageHistory = prevVillageData.history;
                let entryForVillageDiff = null; // Entrada a ser usada para calcular a diferença
                let pontosVilaDiff = 0; // Diferença a ser exibida

                // 1. Tenta encontrar registro de ~24h
                const stagnantVillageTime = now - STAGNANT_THRESHOLD_MS;
                const villageEntry24h = oldVillageHistory.slice().reverse().find(entry => entry.ts < stagnantVillageTime);

                if (villageEntry24h) {
                    entryForVillageDiff = villageEntry24h;
                }
                // 2. Se não achou 24h, tenta o mais antigo (se houver mais de um registro)
                else if (oldVillageHistory.length > 0) {
                    entryForVillageDiff = oldVillageHistory[0]; // Pega o primeiro (mais antigo)
                }

                // Calcula a diferença se encontrou um registro para comparar
                if (entryForVillageDiff) {
                    pontosVilaDiff = pontosVila - entryForVillageDiff.p;
                }
                // Salva novo histórico da aldeia
                let newVillageHistory = [...oldVillageHistory, { ts: now, p: pontosVila }];
                newDataToSave[villageStorageKey] = { history: newVillageHistory.slice(-HISTORY_LIMIT) };

                // --- Histórico e Status do JOGADOR ---
                let status = "N/A";
                if (playerId) {
                    if (isOwner) {
                        status = "Própria";
                    } else {
                        const prevData = oldData[playerId] || { history: [] };
                        const oldHistory = prevData.history;
                        const lastEntry = oldHistory.length > 0 ? oldHistory.slice(-1)[0] : null;

                        if (oldHistory.length <= 1) {
                            status = "Desconhecido";
                        } else {
                            const stagnantTime = now - STAGNANT_THRESHOLD_MS;
                            const inactiveTime = now - INACTIVE_THRESHOLD_MS;
                            const stagnantEntry = oldHistory.slice().reverse().find(e => e.ts < stagnantTime);
                            const inactiveEntry = oldHistory.slice().reverse().find(e => e.ts < inactiveTime);

                            if (inactiveEntry && pontosJogador <= inactiveEntry.p) {
                                status = "Possivelmente inativo (72h)";
                            } else if (stagnantEntry && pontosJogador === stagnantEntry.p) {
                                status = "Estagnado";
                            } else if ((stagnantEntry && pontosJogador > stagnantEntry.p) || (!stagnantEntry && pontosJogador > lastEntry.p)) {
                                status = "Ativo";
                            } else {
                                status = "Em análise";
                            }
                        }
                        // Salva novo histórico do jogador
                        let newHistory = [...oldHistory, { ts: now, p: pontosJogador }];
                        newDataToSave[playerId] = { history: newHistory.slice(-HISTORY_LIMIT) };
                    }
                }

                const tr = document.createElement("tr");
                tr.dataset.tipo = playerId ? "player" : "barbara";
                tr.dataset.pontosVila = pontosVila;
                tr.dataset.status = status;

                // Define a cor de fundo da linha
                if (isOwner) tr.style.backgroundColor = '#f3e5f5';
                else if (bonusData) tr.style.backgroundColor = '#fff9c4';
                else if (isAlly) tr.style.backgroundColor = "#e8f5e9";
                else if (!playerId) tr.style.backgroundColor = "#f0f0f0";
                else if (status === "Possivelmente inativo (72h)") tr.style.backgroundColor = "#ffebee";
                else if (status === "Estagnado") tr.style.backgroundColor = "#fff3e0";
                else if (status === "Ativo") tr.style.backgroundColor = "#e0ffe0";

                // --- Células ---
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

                // Célula Pontos da Aldeia (Evolução 24h ou vs Mais Antigo)
                const tdPontosVila = document.createElement("td");
                tdPontosVila.style.cssText = "padding: 4px; border: 1px solid #ddd;";
                const pontosVilaSpan = document.createElement('span');
                pontosVilaSpan.textContent = pontosVila.toLocaleString('pt-BR');
                tdPontosVila.appendChild(pontosVilaSpan);
                // Mostra a diferença calculada (se houver base de comparação)
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

                    // Cria botão e container de gráficos para TODOS os players
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
                else tdStatus.style.color = "gray"; // Desconhecido, Em análise

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
                    } else { // Ativo, Desconhecido, Em análise
                        linkAttack.style.cssText = btnBaseStyle + "background-color: #f5f5f5; color: #555; border-color: #ccc;";
                    }
                    actionContainer.appendChild(linkAttack);
                    const linkCentralize = document.createElement("a");
                    linkCentralize.href = `/game.php?screen=map&x=${v.x}&y=${v.y}`;
                    linkCentralize.textContent = "Centralizar";
                    linkCentralize.style.cssText = btnBaseStyle + "background-color: #e3f2fd; color: #0d47a1; border-color: #90caf9;";
                    actionContainer.appendChild(linkCentralize);
                }

                if (isAlly && !isOwner) {
                    tdAldeia.style.fontWeight = 'bold'; tdAldeia.style.color = '#1b5e20';
                    tdTribe.style.fontWeight = 'bold'; tdTribe.style.color = '#1b5e20';
                    Array.from(tdTribe.children).forEach(child => { child.style.fontWeight = 'bold'; child.style.color = '#1b5e20'; });
                }

                // Célula TEMPO DE CHEGADA
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
        }

        rebuild();

        // --- Event Listeners ---
        const allRows = [...tabela.querySelectorAll("tbody tr")];
        filtrosDiv.querySelector("#filtroTodas").onclick = () => { allRows.forEach(r => (r.style.display = "")); };
        filtrosDiv.querySelector("#filtroBarbaras").onclick = () => { allRows.forEach(r => (r.style.display = r.dataset.tipo === "barbara" ? "" : "none")); };
        filtrosDiv.querySelector("#filtroPlayers").onclick = () => { allRows.forEach(r => (r.style.display = r.dataset.tipo === "player" ? "" : "none")); };
        filtrosDiv.querySelector("#filtroInativos").onclick = () => { allRows.forEach(r => { const s = r.dataset.status; r.style.display = (s === 'Estagnado' || s === 'Possivelmente inativo (72h)') ? "" : "none"; }); };
        filtrosDiv.querySelector("#btnFiltroPontos").onclick = () => {
            const min = parseInt(filtrosDiv.querySelector("#filtroPontosMin").value, 10) || 0;
            allRows.forEach(r => {
                const p = parseInt(r.dataset.pontosVila, 10) || 0;
                const isTarget = r.dataset.tipo === 'barbara' || r.dataset.status === 'Estagnado' || r.dataset.status === 'Possivelmente inativo (72h)';
                r.style.display = (isTarget && p >= min) ? "" : "none";
            });
        };
        btnToggleGraphsGlobal.onclick = function () {
            const btns = tabela.querySelectorAll("td:nth-child(3) button"); // Apenas botões na coluna Proprietário
            if (btns.length === 0) return;
            const show = btns[0].textContent.includes("Mostrar");
            btns.forEach(btn => {
                if (btn.textContent.includes(show ? "Mostrar" : "Ocultar")) btn.click();
            });
        };

        // --- Rodapé com Notas e Legendas ---
        const foot = document.createElement("div");
        foot.style.cssText = "margin-top: 8px; color: #444; display: flex; gap: 40px; flex-wrap: wrap;";
        const notasDiv = document.createElement("div");
        notasDiv.innerHTML = `<b>Notas:</b> <ul style="margin:4px 0 0 18px; padding:0; list-style-type: disc;"> <li>Gráficos de pontos são carregados do <i>twstats.com</i>.</li> <li>Tempos de chegada calculados com base nas velocidades (min/campo).</li> <li>Evolução de pontos da aldeia compara com registro de ~24h atrás (ou mais antigo).</li> </ul>`;
        const legendasDiv = document.createElement("div");
        legendasDiv.innerHTML = `<b>Legendas (Cores de Fundo):</b> <ul style="margin:4px 0 0 18px; padding:0; list-style-type: none;"> <li style="display:flex; align-items: center; margin-bottom: 2px;"><div style="width:12px; height:12px; background:#f3e5f5; border: 1px solid #ccc; margin-right: 5px;"></div> Aldeia Própria</li> <li style="display:flex; align-items: center; margin-bottom: 2px;"><div style="width:12px; height:12px; background:#e8f5e9; border: 1px solid #ccc; margin-right: 5px;"></div> Aliado</li> <li style="display:flex; align-items: center; margin-bottom: 2px;"><div style="width:12px; height:12px; background:#e0ffe0; border: 1px solid #ccc; margin-right: 5px;"></div> Player Ativo</li> <li style="display:flex; align-items: center; margin-bottom: 2px;"><div style="width:12px; height:12px; background:#ffffff; border: 1px solid #ccc; margin-right: 5px;"></div> Player Desconhecido/Em Análise</li> <li style="display:flex; align-items: center; margin-bottom: 2px;"><div style="width:12px; height:12px; background:#fff3e0; border: 1px solid #ccc; margin-right: 5px;"></div> Player Estagnado</li> <li style="display:flex; align-items: center; margin-bottom: 2px;"><div style="width:12px; height:12px; background:#ffebee; border: 1px solid #ccc; margin-right: 5px;"></div> Player Poss. Inativo (72h)</li> <li style="display:flex; align-items: center; margin-bottom: 2px;"><div style="width:12px; height:12px; background:#f0f0f0; border: 1px solid #ccc; margin-right: 5px;"></div> Aldeia Bárbara</li> <li style="display:flex; align-items: center; margin-bottom: 2px;"><div style="width:12px; height:12px; background:#fff9c4; border: 1px solid #ccc; margin-right: 5px;"></div> Bárbara (com Bônus)</li> </ul> <b style="display: block; margin-top: 8px;">Legendas (Status):</b> <ul style="margin:4px 0 0 18px; padding:0; list-style-type: disc;"> <li><b>Ativo:</b> Ganhou pontos desde a última verificação (>1h) OU nas últimas 24h.</li> <li><b>Estagnado:</b> Pontuação igual há mais de 24h.</li> <li><b>Possivelmente inativo (72h):</b> Pontuação menor ou igual há mais de 72h.</li> <li><b>Em análise:</b> Histórico existe (>1 registro), mas sem ganho recente (<24h) e sem perda significativa.</li><li><b>Desconhecido:</b> Apenas 1 registro no histórico.</li> </ul>`;
        container.appendChild(foot);
        foot.appendChild(notasDiv);
        foot.appendChild(legendasDiv);
    }

    // Estrutura para esperar os dados do jogo carregarem antes de rodar o script
    function waitForGameData() {
        const MAX_TRIES = 50;
        let tries = 0;
        const checker = setInterval(() => {
            if (typeof game_data?.village?.id !== 'undefined' && typeof TWMap?.villages !== 'undefined' && typeof game_data?.player?.id !== 'undefined') {
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

    // Garante que o DOM esteja pronto antes de iniciar a verificação
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', waitForGameData);
    } else {
        waitForGameData();
    }

})();