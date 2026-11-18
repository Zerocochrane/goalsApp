// Todos os textos da interface, em português do Brasil.
// Nenhum texto visível ao usuário deve ficar fixo nos componentes: adicione aqui.
const ptBR = {
  app: {
    name: 'Goals',
    loading: 'Carregando…',
  },
  header: {
    homeLink: 'Ir para o início',
    greeting: (name) => `Olá, ${name}`,
    logout: 'Sair',
    loggingOut: 'Saindo…',
  },
  login: {
    title: 'Entrar',
    subtitle: 'Acesse com seu usuário e senha.',
    username: 'Usuário',
    password: 'Senha',
    submit: 'Entrar',
    submitting: 'Entrando…',
    required: 'Informe usuário e senha.',
    invalid: 'Usuário ou senha inválidos.',
    tooManyAttempts: 'Muitas tentativas de login. Aguarde um minuto e tente novamente.',
  },
  home: {
    title: 'Início',
    today: (date) => `Hoje é ${date}.`,
    placeholder: 'Em breve, suas atividades aparecerão aqui.',
  },
  notFound: {
    title: 'Página não encontrada',
    description: 'O endereço que você acessou não existe.',
    back: 'Voltar para o início',
  },
  errors: {
    network: 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.',
    generic: 'Algo deu errado. Tente novamente.',
  },
};

export default ptBR;
