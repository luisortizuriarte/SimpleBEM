import React, { useState, useEffect, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceArea,
  ResponsiveContainer
} from 'recharts';
import { Play } from 'lucide-react';

// --- JavaScript Translation of the 1D Building Energy Model ---
class BuildingEnergyModel {
  constructor(parameters) {
    this.length_ew = parameters.length_ew;
    this.width_ns = parameters.width_ns;
    this.height = parameters.height;

    this.volume = this.length_ew * this.width_ns * this.height;
    this.a_roof = this.length_ew * this.width_ns;
    this.a_floor = this.length_ew * this.width_ns;
    this.a_wall_n = this.length_ew * this.height;
    this.a_wall_s = this.length_ew * this.height;
    this.a_wall_e = this.width_ns * this.height;
    this.a_wall_w = this.width_ns * this.height;

    this.internal_mass_per_area = parameters.internal_mass_per_area || 150000.0;
    this.internal_heat_capacity = this.a_floor * this.internal_mass_per_area;

    this.lat_rad = parameters.latitude * (Math.PI / 180.0);
    this.doy = parameters.day_of_year;
    this.rho = parameters.rho;
    this.cp = parameters.cp;

    this.frac_win = parameters.frac_win;
    this.cop_cool = parameters.cop_cool;
    this.cop_heat = parameters.cop_heat;
    this.t_cool_target = parameters.tc_target;
    this.t_heat_target = parameters.th_target;
    this.q_target = parameters.q_target !== undefined ? parameters.q_target : 0.012;

    this.env_thickness = parameters.wall_thickness;
    this.env_density = parameters.wall_density;
    this.env_cp = parameters.wall_cp;
    this.env_k = parameters.wall_k;
    this.env_emiss = parameters.wall_emissivity;
    this.shgc = parameters.shgc !== undefined ? parameters.shgc : 0.4;

    this.wall_albedo = parameters.wall_albedo !== undefined ? parameters.wall_albedo : 0.3;
    this.roof_albedo = parameters.roof_albedo !== undefined ? parameters.roof_albedo : 0.2;

    this.t_in = parameters.t_init;
    this.q_in = parameters.q_init;

    const t_init_env = parameters.t_wall_init;
    this.t_surf = {
      Roof: t_init_env,
      N: t_init_env,
      S: t_init_env,
      E: t_init_env,
      W: t_init_env
    };
  }

  step(dt, forcing) {
    const { t_amb, q_amb, sw_in, wind_speed, time_hours, ac_on, occup_sens, occup_lat, equip_sens, vent_rate } = forcing;

    const declination = 23.45 * (Math.PI / 180.0) * Math.sin(2.0 * Math.PI / 365.0 * (284.0 + this.doy));
    const hour_angle = (time_hours - 12.0) * Math.PI / 12.0;

    let cos_zenith = Math.sin(this.lat_rad) * Math.sin(declination) + Math.cos(this.lat_rad) * Math.cos(declination) * Math.cos(hour_angle);
    cos_zenith = Math.max(-1.0, Math.min(1.0, cos_zenith));

    let zenith, azimuth, sw_dir_norm, sw_diffuse;

    if (cos_zenith > 0.0 && sw_in > 0.0) {
      zenith = Math.acos(cos_zenith);
      const sin_zenith = Math.max(0.0001, Math.sin(zenith));

      const sin_az = (Math.cos(declination) * Math.sin(hour_angle)) / sin_zenith;
      const cos_az = (Math.sin(declination) * Math.cos(this.lat_rad) - Math.cos(declination) * Math.sin(this.lat_rad) * Math.cos(hour_angle)) / sin_zenith;
      azimuth = Math.atan2(sin_az, cos_az);

      sw_dir_norm = Math.min(1361.0, (sw_in * 0.8) / Math.max(0.05, cos_zenith));
      sw_diffuse = sw_in * 0.2;
    } else {
      zenith = Math.PI / 2.0;
      azimuth = 0.0;
      sw_dir_norm = 0.0;
      sw_diffuse = sw_in;
    }

    const surf_azimuths = { N: 0.0, W: Math.PI / 2, S: Math.PI, E: -Math.PI / 2 };
    const sw_inc = { Roof: sw_in };

    for (const [direction, az] of Object.entries(surf_azimuths)) {
      let cos_inc = Math.sin(zenith) * Math.cos(azimuth - az);
      cos_inc = Math.max(0.0, cos_inc);
      sw_inc[direction] = (sw_dir_norm * cos_inc) + (sw_diffuse * 0.5);
    }

    const h_out = 5.7 + 3.8 * wind_speed;
    const sigma = 5.67e-8;
    const t_sky = t_amb - 15.0;

    let q_cond_in_total = 0.0;
    let q_win_total = 0.0;

    const areas = {
      Roof: this.a_roof, N: this.a_wall_n,
      S: this.a_wall_s, E: this.a_wall_e, W: this.a_wall_w
    };

    for (const [surf, a_surf] of Object.entries(areas)) {
      const frac_win_surf = surf === 'Roof' ? 0.0 : this.frac_win;
      const a_opaque = a_surf * (1.0 - frac_win_surf);
      const a_win = a_surf * frac_win_surf;

      const t_s = this.t_surf[surf];
      const sw_incident = sw_inc[surf];

      const surf_albedo = surf === 'Roof' ? this.roof_albedo : this.wall_albedo;
      const surf_abs = 1.0 - surf_albedo;

      const q_sw_abs = sw_incident * a_opaque * surf_abs;
      const q_lw_net = this.env_emiss * sigma * a_opaque * (Math.pow(t_s, 4) - Math.pow(t_sky, 4));
      const q_conv_out = h_out * a_opaque * (t_s - t_amb);
      const q_cond_in = (this.env_k / this.env_thickness) * a_opaque * (t_s - this.t_in);

      const heat_cap = a_opaque * this.env_thickness * this.env_density * this.env_cp;
      const q_surf_total = q_sw_abs - q_conv_out - q_cond_in - q_lw_net;
      this.t_surf[surf] = t_s + (dt * q_surf_total) / heat_cap;

      q_cond_in_total += q_cond_in;
      q_win_total += sw_incident * a_win * this.shgc;
    }

    const q_int = occup_sens + equip_sens;
    const mass_flow = vent_rate * this.rho;
    const q_vent = mass_flow * this.cp * (t_amb - this.t_in);

    const t_ground = forcing.t_ground !== undefined ? forcing.t_ground : 295.0;
    const q_floor = (this.env_k / this.env_thickness) * this.a_floor * (t_ground - this.t_in);

    const heat_capacity = (this.volume * this.rho * this.cp) + this.internal_heat_capacity;
    const q_total_no_hvac = q_int + q_win_total + q_cond_in_total + q_vent + q_floor;

    const t_in_next = this.t_in + (dt * q_total_no_hvac) / heat_capacity;

    const e_int = occup_lat;
    const e_vent = mass_flow * (q_amb - this.q_in);
    const e_total_no_hvac = e_int + e_vent;
    const q_in_next = this.q_in + (dt * e_total_no_hvac) / (this.volume * this.rho);

    let q_hvac = 0.0;
    let sens_cool_out = 0.0;
    let sens_heat_out = 0.0;
    let e_hvac = 0.0;

    if (ac_on) {
      if (t_in_next > this.t_cool_target) {
        q_hvac = (this.t_cool_target - t_in_next) * heat_capacity / dt;
        sens_cool_out = Math.abs(q_hvac) * (1.0 + (1.0 / this.cop_cool));
      } else if (t_in_next < this.t_heat_target) {
        q_hvac = (this.t_heat_target - t_in_next) * heat_capacity / dt;
        sens_heat_out = Math.abs(q_hvac) * (1.0 - (1.0 / this.cop_heat));
      }

      if (q_in_next > this.q_target) {
        const req_e_hvac = (q_in_next - this.q_target) * (this.volume * this.rho) / dt;
        const max_e_hvac = (this.volume * this.rho * Math.max(0.0, this.q_in)) / dt;
        e_hvac = Math.min(req_e_hvac, max_e_hvac);
      }
    }

    const q_total = q_total_no_hvac + q_hvac;
    this.t_in = this.t_in + (dt * q_total) / heat_capacity;

    const e_total = e_total_no_hvac - e_hvac;
    this.q_in = this.q_in + (dt * e_total) / (this.volume * this.rho);
    this.q_in = Math.max(0.0, this.q_in);

    return {
      t_in: this.t_in,
      q_in: this.q_in,
      t_roof: this.t_surf.Roof,
      t_wall_s: this.t_surf.S,
      t_wall_n: this.t_surf.N,
      t_wall_e: this.t_surf.E,
      t_wall_w: this.t_surf.W
    };
  }
}

// --- React Component ---
export default function App() {
  const [isSimulating, setIsSimulating] = useState(false);
  const [results, setResults] = useState([]);
  const [acBlocks, setAcBlocks] = useState([]);

  // Simulation controls
  const [simLengthHours, setSimLengthHours] = useState(120);
  const [timeStepSec, setTimeStepSec] = useState(60);

  // Default AC schedule (Off by default, user can toggle)
  const [acSchedule, setAcSchedule] = useState(Array(24).fill(false));

  // Building & Ambient Params
  const [params, setParams] = useState({
    length_ew: 10.0,
    width_ns: 10.0,
    height: 2.5,
    latitude: 38.9,
    day_of_year: 172,
    rho: 1.2,
    cp: 1005.0,
    frac_win: 0.15,
    cop_cool: 3.0,
    cop_heat: 2.5,
    tc_target: 297.0,
    th_target: 293.0,
    q_target: 0.012,
    t_init: 297.0,
    q_init: 0.015,
    wall_thickness: 0.20,
    wall_density: 1800.0,
    wall_cp: 840.0,
    wall_k: 0.1,
    wall_albedo: 0.3,
    roof_albedo: 0.2,
    wall_emissivity: 0.9,
    shgc: 0.4,
    internal_mass_per_area: 150000.0,
    t_wall_init: 298.0,
    vent_rate: 0.15,
    occup_sens: 200.0,
    occup_lat: 0.002
  });

  const handleParamChange = (e) => {
    const { name, value } = e.target;
    // Keeping raw string in state prevents NaN warnings and makes typing decimals easy
    setParams((prev) => ({ ...prev, [name]: value }));
  };

  const toggleAcHour = (hour) => {
    const newSchedule = [...acSchedule];
    newSchedule[hour] = !newSchedule[hour];
    setAcSchedule(newSchedule);
  };

  const runSimulation = () => {
    setIsSimulating(true);

    // Give UI a tick to show "Simulating..."
    setTimeout(() => {
      // Safely parse all string inputs to numbers to prevent math errors
      const parsedParams = {};
      for (const key in params) {
        const val = parseFloat(params[key]);
        parsedParams[key] = isNaN(val) ? 0 : val;
      }

      const model = new BuildingEnergyModel(parsedParams);
      
      const lengthHours = parseFloat(simLengthHours);
      const safeLengthHours = isNaN(lengthHours) ? 120 : lengthHours;
      
      const tStep = parseFloat(timeStepSec);
      const safeTimeStep = isNaN(tStep) || tStep <= 0 ? 60 : tStep;
      
      const steps = Math.floor((safeLengthHours * 3600) / safeTimeStep);
      
      const simData = [];
      const newAcBlocks = [];
      let currentAcBlock = null;

      // Calculate how often to save data to keep charts smooth (~400 points max)
      const saveInterval = Math.max(1, Math.floor(steps / 400));

      for (let step = 0; step < steps; step++) {
        const time_hours = (step * safeTimeStep) / 3600.0;
        const h_mod = time_hours % 24.0;
        
        // Forcing Generation
        const t_amb_k = 302.5 - 5.5 * Math.cos(Math.PI * (h_mod - 4.0) / 12.0);
        const q_amb = 0.018 - 0.002 * Math.cos(Math.PI * (h_mod - 15.0) / 12.0);
        
        let sw_in = 0.0;
        if (h_mod > 6.0 && h_mod < 20.0) {
          sw_in = 950.0 * Math.sin(Math.PI * (h_mod - 6.0) / 14.0);
        }
        
        const wind_speed = 2.0 + 0.33 * Math.sin(Math.PI * (time_hours - 8.0) / 12.0);
        const ac_on = acSchedule[Math.floor(h_mod)];

        const forcing = {
          time_hours,
          t_amb: t_amb_k,
          q_amb,
          sw_in,
          wind_speed,
          ac_on,
          occup_sens: parsedParams.occup_sens,
          occup_lat: parsedParams.occup_lat,
          equip_sens: 300.0,
          vent_rate: parsedParams.vent_rate
        };

        const out = model.step(safeTimeStep, forcing);

        // Downsample data for rendering performance
        if (step === 0 || step % saveInterval === 0 || step === steps - 1) {
          simData.push({
            time: parseFloat(time_hours.toFixed(2)),
            t_amb: parseFloat((t_amb_k - 273.15).toFixed(2)),
            t_in: parseFloat((out.t_in - 273.15).toFixed(2)),
            t_roof: parseFloat((out.t_roof - 273.15).toFixed(2)),
            t_wall_n: parseFloat((out.t_wall_n - 273.15).toFixed(2)),
            t_wall_s: parseFloat((out.t_wall_s - 273.15).toFixed(2)),
            t_wall_e: parseFloat((out.t_wall_e - 273.15).toFixed(2)),
            t_wall_w: parseFloat((out.t_wall_w - 273.15).toFixed(2)),
            q_amb: parseFloat(q_amb.toFixed(5)),
            q_in: parseFloat(out.q_in.toFixed(5)),
            ac_on
          });
        }
      }

      // Calculate AC blocks for Recharts ReferenceArea shading
      simData.forEach((row) => {
        if (row.ac_on && !currentAcBlock) {
          currentAcBlock = { start: row.time };
        } else if (!row.ac_on && currentAcBlock) {
          currentAcBlock.end = row.time;
          newAcBlocks.push(currentAcBlock);
          currentAcBlock = null;
        }
      });
      if (currentAcBlock) {
        currentAcBlock.end = simData[simData.length - 1].time;
        newAcBlocks.push(currentAcBlock);
      }

      setResults(simData);
      setAcBlocks(newAcBlocks);
      setIsSimulating(false);
    }, 50);
  };

  // Run automatically on first mount
  useEffect(() => {
    runSimulation();
    // eslint-disable-next-line
  }, []);

  // Bold colors
  const RED_MAIN = "#E74C3C";
  const RED_LIGHT = "#F1948A";
  const BLUE_MAIN = "#2980B9";
  const BLUE_LIGHT = "#85C1E9";
  const WALL_COLORS = ["#C0392B", "#E67E22", "#D35400", "#F39C12", "#A93226"];

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-800 font-sans overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4 flex justify-between items-center shadow-sm z-10">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-gray-900">1D Building Energy Model</h1>
          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Interactive Dashboard</p>
        </div>
        <button
          onClick={runSimulation}
          disabled={isSimulating}
          className="flex items-center gap-2 bg-gray-900 hover:bg-black text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
        >
          {isSimulating ? (
            <span className="animate-pulse">Simulating...</span>
          ) : (
            <>
              <Play size={16} /> Run Simulation
            </>
          )}
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Controls */}
        <aside className="w-80 bg-white border-r overflow-y-auto flex-shrink-0 p-5 custom-scrollbar shadow-inner z-0">
          
          <div className="mb-8">
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4 border-b pb-2">Simulation Controls</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Length (Hours)</label>
                <input
                  type="number"
                  value={simLengthHours}
                  onChange={(e) => setSimLengthHours(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Time Step (Seconds)</label>
                <input
                  type="number"
                  value={timeStepSec}
                  onChange={(e) => setTimeStepSec(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
              </div>
            </div>
          </div>

          <div className="mb-8">
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4 border-b pb-2">AC Schedule (24h)</h2>
            <p className="text-xs text-gray-500 mb-3 leading-relaxed">Toggle the pills to activate AC during specific hours of the day.</p>
            <div className="grid grid-cols-4 gap-2">
              {acSchedule.map((isOn, hour) => (
                <button
                  key={hour}
                  onClick={() => toggleAcHour(hour)}
                  className={`py-1.5 rounded text-xs font-bold transition-all ${
                    isOn
                      ? "bg-blue-600 text-white shadow-sm"
                      : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                  }`}
                >
                  {hour.toString().padStart(2, '0')}:00
                </button>
              ))}
            </div>
          </div>

          <div className="mb-6">
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4 border-b pb-2">Building Envelope</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Length E-W (m)</label>
                <input name="length_ew" type="number" value={params.length_ew} onChange={handleParamChange} className="w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Width N-S (m)</label>
                <input name="width_ns" type="number" value={params.width_ns} onChange={handleParamChange} className="w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Height (m)</label>
                <input name="height" type="number" value={params.height} onChange={handleParamChange} className="w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Wall Insulation (k) [W/m-K]</label>
                <input name="wall_k" type="number" step="0.01" value={params.wall_k} onChange={handleParamChange} className="w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Wall Albedo</label>
                  <input name="wall_albedo" type="number" step="0.05" value={params.wall_albedo} onChange={handleParamChange} className="w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Roof Albedo</label>
                  <input name="roof_albedo" type="number" step="0.05" value={params.roof_albedo} onChange={handleParamChange} className="w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Internal Mass (J/m²-K)</label>
                <input name="internal_mass_per_area" type="number" step="10000" value={params.internal_mass_per_area} onChange={handleParamChange} className="w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm" />
              </div>
            </div>
          </div>

          <div className="mb-6">
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4 border-b pb-2">Loads & Ventilation</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Ventilation Rate (m³/s)</label>
                <input name="vent_rate" type="number" step="0.01" value={params.vent_rate} onChange={handleParamChange} className="w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Occupant Sensible Heat (W)</label>
                <input name="occup_sens" type="number" step="10" value={params.occup_sens} onChange={handleParamChange} className="w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Occupant Latent Heat (kg/s)</label>
                <input name="occup_lat" type="number" step="0.001" value={params.occup_lat} onChange={handleParamChange} className="w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm" />
              </div>
            </div>
          </div>
        </aside>

        {/* Main Chart Area */}
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Panel 1: Ambient vs Indoor Temperature */}
          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 rounded-full" style={{backgroundColor: RED_MAIN}}></div>
              <h3 className="font-bold text-gray-800">Ambient vs. Indoor Temperature</h3>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer>
                <LineChart data={results} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} tickCount={10} tick={{fontSize: 12, fill: '#6B7280'}} tickFormatter={(t) => `${t}h`} />
                  <YAxis tick={{fontSize: 12, fill: '#6B7280'}} domain={['auto', 'auto']} label={{ value: 'Temp (°C)', angle: -90, position: 'insideLeft', style: {textAnchor: 'middle', fill: '#6B7280', fontSize: 12, fontWeight: 'bold'} }} />
                  <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }} labelFormatter={(val) => `Hour: ${val}`} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', fontWeight: '500' }} />
                  
                  {acBlocks.map((block, i) => (
                    <ReferenceArea key={i} x1={block.start} x2={block.end} fill="#E2E8F0" fillOpacity={0.5} />
                  ))}
                  
                  <Line type="monotone" dataKey="t_amb" name="Ambient Temp" stroke={RED_LIGHT} strokeWidth={2} strokeDasharray="5 5" dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="t_in" name="Indoor Temp" stroke={RED_MAIN} strokeWidth={3} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Panel 2: Envelope Temperatures */}
          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 rounded-full bg-orange-500"></div>
              <h3 className="font-bold text-gray-800">Envelope Surface Temperatures</h3>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer>
                <LineChart data={results} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} tickCount={10} tick={{fontSize: 12, fill: '#6B7280'}} tickFormatter={(t) => `${t}h`} />
                  <YAxis tick={{fontSize: 12, fill: '#6B7280'}} domain={['auto', 'auto']} label={{ value: 'Temp (°C)', angle: -90, position: 'insideLeft', style: {textAnchor: 'middle', fill: '#6B7280', fontSize: 12, fontWeight: 'bold'} }} />
                  <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }} labelFormatter={(val) => `Hour: ${val}`} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', fontWeight: '500' }} />
                  
                  <Line type="monotone" dataKey="t_roof" name="Roof" stroke={WALL_COLORS[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="t_wall_s" name="South Wall" stroke={WALL_COLORS[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="t_wall_w" name="West Wall" stroke={WALL_COLORS[2]} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="t_wall_e" name="East Wall" stroke={WALL_COLORS[3]} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="t_wall_n" name="North Wall" stroke={WALL_COLORS[4]} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Panel 3: Humidity */}
          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 rounded-full" style={{backgroundColor: BLUE_MAIN}}></div>
              <h3 className="font-bold text-gray-800">Ambient vs. Indoor Humidity</h3>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer>
                <LineChart data={results} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} tickCount={10} tick={{fontSize: 12, fill: '#6B7280'}} tickFormatter={(t) => `${t}h`} />
                  <YAxis tick={{fontSize: 12, fill: '#6B7280'}} tickFormatter={(v) => v.toFixed(3)} domain={['auto', 'auto']} label={{ value: 'Hum (kg/kg)', angle: -90, position: 'insideLeft', style: {textAnchor: 'middle', fill: '#6B7280', fontSize: 12, fontWeight: 'bold'} }} />
                  <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }} labelFormatter={(val) => `Hour: ${val}`} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', fontWeight: '500' }} />
                  
                  {acBlocks.map((block, i) => (
                    <ReferenceArea key={i} x1={block.start} x2={block.end} fill="#E2E8F0" fillOpacity={0.5} />
                  ))}
                  
                  <Line type="monotone" dataKey="q_amb" name="Ambient Hum" stroke={BLUE_LIGHT} strokeWidth={2} strokeDasharray="5 5" dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="q_in" name="Indoor Hum" stroke={BLUE_MAIN} strokeWidth={3} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

        </main>
      </div>
    </div>
  );
}