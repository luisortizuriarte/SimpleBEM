from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, List
import math

# --- 1D Building Energy Model ---
class BuildingEnergyModel:
    def __init__(self, parameters: Dict[str, float]):
        self.length_ew = parameters.get('length_ew', 10.0)
        self.width_ns = parameters.get('width_ns', 10.0)
        self.height = parameters.get('height', 2.5)
        
        self.volume = self.length_ew * self.width_ns * self.height
        self.a_roof = self.length_ew * self.width_ns
        self.a_floor = self.length_ew * self.width_ns
        self.a_wall_n = self.length_ew * self.height
        self.a_wall_s = self.length_ew * self.height
        self.a_wall_e = self.width_ns * self.height
        self.a_wall_w = self.width_ns * self.height
        
        self.internal_mass_per_area = parameters.get('internal_mass_per_area', 150000.0)
        self.internal_heat_capacity = self.a_floor * self.internal_mass_per_area
        
        self.lat_rad = math.radians(parameters.get('latitude', 38.9))
        self.doy = parameters.get('day_of_year', 172)
        self.rho = parameters.get('rho', 1.2)
        self.cp = parameters.get('cp', 1005.0)
        
        self.frac_win = parameters.get('frac_win', 0.15)
        self.cop_cool = parameters.get('cop_cool', 3.0)
        self.cop_heat = parameters.get('cop_heat', 2.5)
        self.t_cool_target = parameters.get('tc_target', 297.0)
        self.t_heat_target = parameters.get('th_target', 293.0)
        self.q_target = parameters.get('q_target', 0.012)
        
        self.env_thickness = parameters.get('wall_thickness', 0.2)
        self.env_density = parameters.get('wall_density', 1800.0)
        self.env_cp = parameters.get('wall_cp', 840.0)
        self.env_k = parameters.get('wall_k', 0.1)
        self.env_emiss = parameters.get('wall_emissivity', 0.9)
        self.shgc = parameters.get('shgc', 0.4)
        
        self.wall_albedo = parameters.get('wall_albedo', 0.3)
        self.roof_albedo = parameters.get('roof_albedo', 0.2)
        
        self.t_in = parameters.get('t_init', 297.0)
        self.q_in = parameters.get('q_init', 0.015)
        
        t_init_env = parameters.get('t_wall_init', 298.0)
        self.t_surf = {
            'Roof': t_init_env, 
            'N': t_init_env, 
            'S': t_init_env, 
            'E': t_init_env, 
            'W': t_init_env
        }

    def step(self, dt: float, forcing: Dict[str, float]) -> Dict[str, float]:
        t_amb = forcing['t_amb']
        q_amb = forcing['q_amb']
        sw_in = forcing['sw_in']
        wind_speed = forcing['wind_speed']
        time_hours = forcing['time_hours']
        ac_on = forcing['ac_on']
        occup_sens = forcing['occup_sens']
        occup_lat = forcing['occup_lat']
        equip_sens = forcing['equip_sens']
        vent_rate = forcing['vent_rate']

        declination = 23.45 * (math.pi / 180.0) * math.sin(2.0 * math.pi / 365.0 * (284.0 + self.doy))
        hour_angle = (time_hours - 12.0) * math.pi / 12.0
        
        cos_zenith = math.sin(self.lat_rad) * math.sin(declination) + math.cos(self.lat_rad) * math.cos(declination) * math.cos(hour_angle)
        cos_zenith = max(-1.0, min(1.0, cos_zenith))
        
        if cos_zenith > 0.0 and sw_in > 0.0:
            zenith = math.acos(cos_zenith)
            sin_zenith = max(0.0001, math.sin(zenith))
            sin_az = (math.cos(declination) * math.sin(hour_angle)) / sin_zenith
            cos_az = (math.sin(declination) * math.cos(self.lat_rad) - math.cos(declination) * math.sin(self.lat_rad) * math.cos(hour_angle)) / sin_zenith
            azimuth = math.atan2(sin_az, cos_az)
            sw_dir_norm = min(1361.0, (sw_in * 0.8) / max(0.05, cos_zenith))
            sw_diffuse = sw_in * 0.2
        else:
            zenith = math.pi / 2.0
            azimuth = 0.0
            sw_dir_norm = 0.0
            sw_diffuse = sw_in
            
        surf_azimuths = {'N': 0.0, 'W': math.pi/2, 'S': math.pi, 'E': -math.pi/2}
        sw_inc = {'Roof': sw_in}
        for direction, az in surf_azimuths.items():
            cos_inc = math.sin(zenith) * math.cos(azimuth - az)
            cos_inc = max(0.0, cos_inc)
            sw_inc[direction] = (sw_dir_norm * cos_inc) + (sw_diffuse * 0.5)

        h_out = 5.7 + 3.8 * wind_speed
        sigma = 5.67e-8
        t_sky = t_amb - 15.0
        
        q_cond_in_total = 0.0
        q_win_total = 0.0
        areas = {'Roof': self.a_roof, 'N': self.a_wall_n, 'S': self.a_wall_s, 'E': self.a_wall_e, 'W': self.a_wall_w}
        
        for surf, a_surf in areas.items():
            frac_win_surf = 0.0 if surf == 'Roof' else self.frac_win
            a_opaque = a_surf * (1.0 - frac_win_surf)
            a_win = a_surf * frac_win_surf
            
            t_s = self.t_surf[surf]
            sw_incident = sw_inc[surf]
            surf_albedo = self.roof_albedo if surf == 'Roof' else self.wall_albedo
            surf_abs = 1.0 - surf_albedo
            
            q_sw_abs = sw_incident * a_opaque * surf_abs
            q_lw_net = self.env_emiss * sigma * a_opaque * ((t_s ** 4) - (t_sky ** 4))
            q_conv_out = h_out * a_opaque * (t_s - t_amb)
            q_cond_in = (self.env_k / self.env_thickness) * a_opaque * (t_s - self.t_in)
            
            heat_cap = a_opaque * self.env_thickness * self.env_density * self.env_cp
            q_surf_total = q_sw_abs - q_conv_out - q_cond_in - q_lw_net
            self.t_surf[surf] = t_s + (dt * q_surf_total) / heat_cap
            
            q_cond_in_total += q_cond_in
            q_win_total += sw_incident * a_win * self.shgc

        q_int = occup_sens + equip_sens
        mass_flow = vent_rate * self.rho
        q_vent = mass_flow * self.cp * (t_amb - self.t_in)
        
        t_ground = forcing.get('t_ground', 295.0)
        q_floor = (self.env_k / self.env_thickness) * self.a_floor * (t_ground - self.t_in)
        
        heat_capacity = (self.volume * self.rho * self.cp) + self.internal_heat_capacity
        q_total_no_hvac = q_int + q_win_total + q_cond_in_total + q_vent + q_floor
        t_in_next = self.t_in + (dt * q_total_no_hvac) / heat_capacity
        
        e_int = occup_lat
        e_vent = mass_flow * (q_amb - self.q_in)
        e_total_no_hvac = e_int + e_vent
        q_in_next = self.q_in + (dt * e_total_no_hvac) / (self.volume * self.rho)
        
        q_hvac = 0.0
        sens_cool_out = 0.0
        sens_heat_out = 0.0
        e_hvac = 0.0
        
        if ac_on:
            if t_in_next > self.t_cool_target:
                q_hvac = (self.t_cool_target - t_in_next) * heat_capacity / dt
                sens_cool_out = abs(q_hvac) * (1.0 + (1.0 / self.cop_cool))
            elif t_in_next < self.t_heat_target:
                q_hvac = (self.t_heat_target - t_in_next) * heat_capacity / dt
                sens_heat_out = abs(q_hvac) * (1.0 - (1.0 / self.cop_heat))
                
            if q_in_next > self.q_target:
                req_e_hvac = (q_in_next - self.q_target) * (self.volume * self.rho) / dt
                max_e_hvac = (self.volume * self.rho * max(0.0, self.q_in)) / dt
                e_hvac = min(req_e_hvac, max_e_hvac)
        
        q_total = q_total_no_hvac + q_hvac
        self.t_in = self.t_in + (dt * q_total) / heat_capacity
        e_total = e_total_no_hvac - e_hvac
        self.q_in = max(0.0, self.q_in + (dt * e_total) / (self.volume * self.rho))
        
        return {
            't_in': self.t_in, 'q_in': self.q_in, 'sens_cool_out': sens_cool_out,
            'sens_heat_out': sens_heat_out, 't_roof': self.t_surf['Roof'],
            't_wall_s': self.t_surf['S'], 't_wall_n': self.t_surf['N'],
            't_wall_e': self.t_surf['E'], 't_wall_w': self.t_surf['W']
        }

# --- FastAPI Server ---
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict this to your React domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SimulationPayload(BaseModel):
    parameters: Dict[str, float]
    sim_length_hours: float
    time_step_sec: float
    ac_schedule: List[bool]

@app.post("/simulate")
def run_simulation(payload: SimulationPayload):
    params = payload.parameters
    model = BuildingEnergyModel(params)
    
    dt = payload.time_step_sec
    steps = int((payload.sim_length_hours * 3600) / dt)
    save_interval = max(1, int(steps / 400))
    
    sim_data = []
    ac_blocks = []
    current_ac_block = None
    
    for step in range(steps):
        time_hours = (step * dt) / 3600.0
        h_mod = time_hours % 24.0
        
        # Weather Forcing
        t_amb_k = 302.5 - 5.5 * math.cos(math.pi * (h_mod - 4.0) / 12.0)
        q_amb = 0.018 - 0.002 * math.cos(math.pi * (h_mod - 15.0) / 12.0)
        sw_in = 950.0 * math.sin(math.pi * (h_mod - 6.0) / 14.0) if 6.0 < h_mod < 20.0 else 0.0
        wind_speed = 2.0 + 0.33 * math.sin(math.pi * (time_hours - 8.0) / 12.0)
        
        ac_hour_index = int(math.floor(h_mod))
        ac_on = payload.ac_schedule[ac_hour_index] if ac_hour_index < len(payload.ac_schedule) else False
        
        forcing = {
            'time_hours': time_hours,
            't_amb': t_amb_k,
            'q_amb': q_amb,
            'sw_in': sw_in,
            'wind_speed': wind_speed,
            'ac_on': ac_on,
            'occup_sens': params.get('occup_sens', 200.0),
            'occup_lat': params.get('occup_lat', 0.002),
            'equip_sens': 300.0,
            'vent_rate': params.get('vent_rate', 0.15)
        }
        
        out = model.step(dt, forcing)
        
        if step == 0 or step % save_interval == 0 or step == steps - 1:
            row = {
                "time": round(time_hours, 2),
                "t_amb": round(t_amb_k - 273.15, 2),
                "t_in": round(out['t_in'] - 273.15, 2),
                "t_roof": round(out['t_roof'] - 273.15, 2),
                "t_wall_n": round(out['t_wall_n'] - 273.15, 2),
                "t_wall_s": round(out['t_wall_s'] - 273.15, 2),
                "t_wall_e": round(out['t_wall_e'] - 273.15, 2),
                "t_wall_w": round(out['t_wall_w'] - 273.15, 2),
                "q_amb": round(q_amb, 5),
                "q_in": round(out['q_in'], 5),
                "ac_on": ac_on
            }
            sim_data.append(row)
            
    for row in sim_data:
        if row["ac_on"] and not current_ac_block:
            current_ac_block = {"start": row["time"]}
        elif not row["ac_on"] and current_ac_block:
            current_ac_block["end"] = row["time"]
            ac_blocks.append(current_ac_block)
            current_ac_block = None
            
    if current_ac_block:
        current_ac_block["end"] = sim_data[-1]["time"]
        ac_blocks.append(current_ac_block)
        
    return {"results": sim_data, "acBlocks": ac_blocks}