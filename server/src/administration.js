import {audit,fail,operator,transaction} from './store.js';

export function installAdministration(app,{pool,config,validate,email}) {
  const requireAdmin=req=>{if(!operator(req.user,config))fail(403,'operator_required','Требуются права администратора платформы.');};
  app.get('/api/platform-admins',async(req,res)=>{
    requireAdmin(req);
    const saved=(await pool.query('SELECT email,created_at FROM platform_admins ORDER BY email')).rows;
    const emails=new Map(saved.map(a=>[a.email,{...a,protected:false}]));
    for(const value of config.adminEmails)emails.set(value,{email:value,protected:true,created_at:null});
    res.json({administrators:[...emails.values()].sort((a,b)=>a.email.localeCompare(b.email))});
  });
  for(const method of ['put','delete'])app[method]('/api/platform-admins/:email',async(req,res)=>{
    requireAdmin(req);
    const target=validate(email,req.params.email);
    await transaction(pool,async c=>{
      await c.query('SELECT pg_advisory_xact_lock(63821018)');
      if(!config.adminEmails.includes(req.user.email) && !(await c.query('SELECT 1 FROM platform_admins WHERE email=$1',[req.user.email])).rowCount)
        fail(403,'operator_required','Права администратора платформы отозваны.');
      if(method==='delete'){
        if(config.adminEmails.includes(target))fail(409,'protected_admin','Основной администратор задаётся на сервере и защищён от удаления.');
        if(target===req.user.email)fail(409,'self_removal','Нельзя отозвать собственные права администратора.');
        const result=await c.query('DELETE FROM platform_admins WHERE email=$1',[target]);
        if(result.rowCount)await audit(c,req.user,'platform.admin.remove',null,{email:target});
      }else if(!config.adminEmails.includes(target)){
        const result=await c.query('INSERT INTO platform_admins(email,added_by) VALUES($1,$2) ON CONFLICT DO NOTHING',[target,req.user.id]);
        if(result.rowCount)await audit(c,req.user,'platform.admin.add',null,{email:target});
      }
    });res.json({ok:true});
  });
}
